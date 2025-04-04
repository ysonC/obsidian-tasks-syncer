# Task Syncer Plugin for Obsidian

This Obsidian plugin syncs tasks between Obsidian notes and Microsoft To-Do. You can easily manage your Microsoft To-Do tasks directly from Obsidian.

## Features

- Sync tasks from Obsidian notes directly into Microsoft To-Do.
- Mark tasks as complete directly from Obsidian.
- Sidebar integration for showing current targeted list's task.

## Using the Plugin

### Commands

- **Open Microsoft To-Do Sidebar**: View your tasks directly.
- **Login to Microsoft To-Do**: Authenticate your Microsoft account.
- **Refresh Microsoft To-Do Token**: Refresh authentication manually.
- **Push All Tasks from Note**: Sync tasks from your active note.
- **Create and Push Task**: Add a single task directly.
- **Show Not Started Tasks List**: To mark tasks as completed.
- **Select Task List**: Change the target list in Microsoft To-Do.
- **Delete Completed Tasks**: Remove all completed tasks in the targeted list.

---

## Supported Platforms

- **Microsoft To-Do** (more integrations coming soon!)

---

## Setup

### Prerequisites

You'll need an Azure AD Application set up to integrate with Microsoft To-Do:

1. Go to the [Azure Portal](https://portal.azure.com).
2. Click on **Azure Active Directory** → **App registrations** → **New registration**.
3. Enter a name (e.g., "Obsidian Task Syncer").
4. Set **Supported account types** to **Accounts in any organizational directory and personal Microsoft accounts**.
5. Set **Redirect URI** to `http://localhost:5000` and select type **Web**.
6. Click **Register**.
7. After registration, note down the **Application (client) ID**.

### Get Client Secret

1. From your app registration, go to **Certificates & secrets**.
2. Click **New client secret**.
3. Add a description and set expiration to your preference.
4. After creation, copy and save your **client secret** securely.

---

## Plugin Installation

1. Clone this repository into your Obsidian plugins folder:

```bash
git clone https://github.com/your-username/task-syncer-plugin.git
```

2. Install dependencies:

```bash
npm install
```

3. Build the plugin:

```bash
npm run build
```

4. In Obsidian, enable the plugin under **Settings → Community plugins**.

---

## Configuration

After installation:

1. Open Obsidian **Settings**.
2. Navigate to **Microsoft To-Do Settings** tab.
3. Enter your **Client ID**, **Client Secret**, and **Redirect URL** (`http://localhost:5000`).
4. Reload the plugin.
5. Click **Get Task Lists** to fetch your available Microsoft To-Do lists.
6. Select the task list you want to sync with.

---

## Development

- `npm run dev`: Runs the plugin in development mode.
- Changes to `.ts` files will automatically rebuild.

---

## License

[MIT License](LICENSE)
