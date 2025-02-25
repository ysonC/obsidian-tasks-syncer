import json
import os
import threading
import webbrowser

import requests
from dotenv import load_dotenv
from flask import Flask, request
from msal import ConfidentialClientApplication

# Load environment variables from .env file
load_dotenv()

# Flask app for capturing authorization code
app = Flask(__name__)
auth_code = None
TOKEN_FILE = "token_data.json"


@app.route("/")
def catch_auth_code():
    """Capture authorization code from the redirect URL."""
    global auth_code
    auth_code = request.args.get("code")
    return "Authorization successful! You can close this tab."


def start_flask_server():
    """Start a temporary local server to catch the authorization code."""
    app.run(port=5000, debug=False, use_reloader=False)


def save_token_data(token_data):
    """Save token data (access & refresh tokens) to a file."""
    with open(TOKEN_FILE, "w") as f:
        json.dump(token_data, f)


def load_token_data():
    """Load token data from file if available."""
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, "r") as f:
            return json.load(f)
    return None


def create_confidential_client_app(client_id, client_secret, authority):
    """Initialize the Microsoft Identity Platform client."""
    return ConfidentialClientApplication(
        client_id, authority=authority, client_credential=client_secret
    )


def full_login(client_app, scopes):
    """Perform a full authentication with user interaction."""
    global auth_code

    server_thread = threading.Thread(target=start_flask_server)
    server_thread.daemon = True
    server_thread.start()

    auth_url = client_app.get_authorization_request_url(
        scopes,
        redirect_uri="http://localhost:5000",
        params={"prompt": "select_account"},
    )
    webbrowser.open(auth_url, new=True)

    while auth_code is None:
        pass  # Wait for auth code

    token_data = client_app.acquire_token_by_authorization_code(
        code=auth_code, scopes=scopes, redirect_uri="http://localhost:5000"
    )

    save_token_data(token_data)
    return token_data.get("access_token")


def get_access_token(client_app, scopes):
    """Retrieve a valid access token, refreshing if necessary."""
    token_data = load_token_data()

    if token_data and "refresh_token" in token_data:
        print("Attempting to refresh access token...")
        new_token_data = client_app.acquire_token_by_refresh_token(
            token_data["refresh_token"], scopes
        )

        if "access_token" in new_token_data:
            print("Token refreshed successfully!")
            save_token_data(new_token_data)
            return new_token_data["access_token"]

    print("Refresh token expired or invalid. Re-authenticating...")
    return full_login(client_app, scopes)


def get_todo_lists(access_token):
    """Fetch all To-Do lists and return them as a dictionary."""
    url = "https://graph.microsoft.com/v1.0/me/todo/lists"
    headers = {"Authorization": f"Bearer {access_token}"}

    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        lists = response.json().get("value", [])
        return {
            lst["displayName"]: lst["id"] for lst in lists
        }  # Return as {list_name: list_id}

    print("Failed to fetch lists:", response.text)
    return {}


def get_tasks_from_list(access_token, list_id):
    """Fetch tasks from a selected To-Do list using its ID."""
    url = f"https://graph.microsoft.com/v1.0/me/todo/lists/{list_id}/tasks"
    headers = {"Authorization": f"Bearer {access_token}"}

    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        tasks = response.json().get("value", [])
        return [task["title"] for task in tasks]  # Return list of task names

    print("Failed to fetch tasks:", response.text)
    return []


def add_task_to_list(access_token, list_id, task_title):
    """Add a new task to a specified To-Do list."""
    url = f"https://graph.microsoft.com/v1.0/me/todo/lists/{list_id}/tasks"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    data = {"title": task_title}

    response = requests.post(url, headers=headers, json=data)
    if response.status_code == 201:
        print(f"\n✅ Task '{task_title}' added successfully!")
    else:
        print("\n❌ Failed to add task:", response.text)


# Constants
CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
AUTHORITY = "https://login.microsoftonline.com/consumers/"
SCOPE = ["Tasks.ReadWrite"]

client_app = create_confidential_client_app(CLIENT_ID, CLIENT_SECRET, AUTHORITY)
access_token = get_access_token(client_app, SCOPE)

# Fetch and display To-Do lists
todo_lists = get_todo_lists(access_token)
if not todo_lists:
    print("No To-Do lists found.")
    exit()

print("\n📌 Available To-Do Lists:")
for idx, (list_name, _) in enumerate(todo_lists.items(), start=1):
    print(f"{idx}. {list_name}")

# Ask user to select a list
try:
    choice = int(input("\nEnter the number of the list to view tasks: ")) - 1
    selected_list_name = list(todo_lists.keys())[choice]
    selected_list_id = todo_lists[selected_list_name]
    print(f"\n📋 Fetching tasks from '{selected_list_name}'...\n")

    # Fetch and display tasks from the selected list
    tasks = get_tasks_from_list(access_token, selected_list_id)
    if tasks:
        print("\n📝 Tasks in this list:")
        for task in tasks:
            print(f"- {task}")
    else:
        print("No tasks found in this list.")

    # Ask if user wants to add a new task
    add_task = (
        input("\n➕ Do you want to add a new task to this list? (yes/no): ")
        .strip()
        .lower()
    )
    if add_task == "yes":
        task_title = input("Enter the task title: ").strip()
        add_task_to_list(access_token, selected_list_id, task_title)
except (ValueError, IndexError):
    print("❌ Invalid selection.")
