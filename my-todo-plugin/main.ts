import { Plugin, Notice } from "obsidian";
import { PublicClientApplication, Configuration } from "@azure/msal-node";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { BrowserWindow } from "@electron/remote"; // Electron's BrowserWindow
import fetch from "node-fetch"; // If not available globally, install node-fetch

// Constants for OAuth flow
const CLIENT_ID: string = process.env.CLIENT_ID ?? "";
const CLIENT_SECRET: string = process.env.CLIENT_SECRET ?? "";
const AUTHORITY = "https://login.microsoftonline.com/consumers";
const REDIRECT_URI = "http://localhost:5000"; // Must be registered in Azure
const SCOPES = "Tasks.ReadWrite offline_access";
const TOKEN_ENDPOINT = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

export default class MyTodoPlugin extends Plugin {
	private tokenFilePath: string;
	private pluginDir: string;
	private pca: PublicClientApplication;

	async onload() {
		this.initializePlugin();
	}

	initializePlugin() {
		// Determine the plugin directory inside Obsidian's .obsidian/plugins/ folder
		this.pluginDir = path.join(this.app.vault.configDir, "plugins/my-todo-plugin");
		console.log("Plugin directory: ", this.pluginDir);

		this.tokenFilePath = path.join(this.pluginDir, "auth_token.json");
		console.log("Token file path: ", this.tokenFilePath);

		// Define the development path for .env
		const devEnvPath = "/home/yson/projects/sync-obsidian-todo-plugin/my-todo-plugin/.env";

		if (fs.existsSync(devEnvPath)) {
			dotenv.config({ path: devEnvPath });
			console.log("Loaded environment variables from:", devEnvPath);
		} else {
			console.warn("Environment file not found at:", devEnvPath);
		}

		// Log out the client credentials (for debugging; remove in production)
		console.log("Client ID: ", CLIENT_ID);
		console.log("Client Secret: ", CLIENT_SECRET);

		const config: Configuration = {
			auth: {
				clientId: CLIENT_ID,
				authority: AUTHORITY,
				clientSecret: CLIENT_SECRET,
			},
		};

		console.log("MSAL Configuration: ", config);

		// Initialize the PublicClientApplication instance
		this.pca = new PublicClientApplication(config);

		// Register a command in Obsidian to trigger the login process
		this.addCommand({
			id: "login-microsoft-todo",
			name: "Login to Microsoft To-Do",
			callback: async () => {
				try {
					const tokenData = await this.authenticateWithMicrosoft();
					new Notice("Logged in successfully!");
					console.log("Access Token: ", tokenData.accessToken);
					// Save tokenData to file if needed
				} catch (error) {
					console.error("Authentication error:", error);
					new Notice("❌ Login failed! Check the console for details.");
				}
			},
		});

		new Notice("Microsoft To-Do Plugin Loaded!");
	}

	async authenticateWithMicrosoft(): Promise<{ accessToken: string, refreshToken: string, expiresIn: number }> {
		return new Promise((resolve, reject) => {
			// 1. Construct the authorization URL
			const authUrl = `${AUTHORITY}/oauth2/v2.0/authorize?client_id=${CLIENT_ID}`
				+ `&response_type=code`
				+ `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
				+ `&response_mode=query`
				+ `&scope=${encodeURIComponent(SCOPES)}`;

			// 2. Open an Electron BrowserWindow for the Microsoft login
			const authWindow = new BrowserWindow({
				width: 600,
				height: 700,
				webPreferences: {
					nodeIntegration: false,
					contextIsolation: true,
				}
			});
			authWindow.loadURL(authUrl);
			console.log("Opened auth window");

			// 3. Intercept the redirect to our redirect URI
			authWindow.webContents.on("will-redirect", (event, url) => {
				console.log("Will redirect to: ", url);
				try {
					const redirectURL = new URL(url);
					const authCode = redirectURL.searchParams.get('code');
					console.log("Auth code: ", authCode);
				} catch (err) {
					console.error("Error in will-redirect event: ", err);
				}
				authWindow.close();
			});

		});
	}
}

