import { Plugin, Notice } from "obsidian";
import { PublicClientApplication, Configuration } from "@azure/msal-node";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import * as express from "express";


export default class MyTodoPlugin extends Plugin {
	private tokenFilePath: string;
	private pluginDir: string;
	private pca: PublicClientApplication;
	async onload() {
		this.initializePlugin();
	}

	initializePlugin() {
		// Determine the plugin directory inside Obsidian's `.obsidian/plugins/` folder
		this.pluginDir = path.join(this.app.vault.configDir, "plugins/my-todo-plugin");
		console.log("Plugin directory: ", this.pluginDir);

		this.tokenFilePath = path.join(this.pluginDir, "auth_token.json");
		console.log("Token file path: ", this.tokenFilePath);

		// Explicitly define the real development path for .env
		const devEnvPath = "/home/yson/projects/sync-obsidian-todo-plugin/my-todo-plugin/.env";

		if (fs.existsSync(devEnvPath)) {
			dotenv.config({ path: devEnvPath });
			console.log("Loaded environment variables from:", devEnvPath);
		} else {
			console.warn("Evironment file not found at:", devEnvPath);
		}

		// Load environment variables for authentication
		const CLIENT_ID: string = process.env.CLIENT_ID ?? "";
		const CLIENT_SECRET: string = process.env.CLIENT_SECRET ?? "";
		console.log("Client ID: ", CLIENT_ID);
		console.log("Client Secret: ", CLIENT_SECRET);
		const AUTHORITY = "https://login.microsoftonline.com/consumers";

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
				await this.loginUser();
			},
		});

		new Notice("Microsoft To-Do Plugin Loaded!");
	}


	async loginUser() {
		try {
			const authCodeUrlParameters = {
				scopes: ["Tasks.ReadWrite"],
				redirectUri: "http://localhost:5000",
			};

			console.log("Check point")
			const authUrl = await this.pca.getAuthCodeUrl(authCodeUrlParameters);
			new Notice("Open this URL in your browser to log in: " + authUrl);
			console.log("Auth URL: ", authUrl);

			// Start an Express server to catch the authorization code
			const authCode = await new Promise<string>((resolve) => {
				const app = express(); // no .default needed
				const server = app.listen(5000, () => {
					console.log("Listening on http://localhost:5000 for authentication response...");
				});

				// Provide explicit types for req/res
				app.get("/", (req: express.Request, res: express.Response) => {
					const code = req.query.code as string;
					console.log("Auth code received:", code);
					res.send("Authorization successful! You can close this tab.");
					server.close();
					resolve(code);
				});
			});
			
			console.log("Auth code: ", authCode);

		} catch (error) {
			console.error("Login Error:", error);
			new Notice("❌ Login faile//d! Check the console for details.");
		}
	}
}













