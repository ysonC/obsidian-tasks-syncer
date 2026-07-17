import * as fs from "fs";

export interface AuthProvider {
	login(): Promise<string>;
	getAccessToken(): Promise<string>;
	logout(): Promise<void>;
	isAuthenticated(): Promise<boolean>;
}
export interface TokenStore { read(): Promise<string>; write(value: string): Promise<void>; remove(): Promise<void>; }
export class FileTokenStore implements TokenStore {
	constructor(private filePath: string) {}
	async read() { return fs.existsSync(this.filePath) ? fs.readFileSync(this.filePath, "utf8") : ""; }
	async write(value: string) { fs.writeFileSync(this.filePath, value, { mode: 0o600 }); fs.chmodSync(this.filePath, 0o600); }
	async remove() { if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath); }
}

export function migrateLegacyTokenCache(legacyPath: string, currentPath: string): void {
	if (fs.existsSync(currentPath)) {
		fs.chmodSync(currentPath, 0o600);
		return;
	}
	if (!fs.existsSync(legacyPath)) return;
	try {
		fs.copyFileSync(legacyPath, currentPath, fs.constants.COPYFILE_EXCL);
		fs.chmodSync(currentPath, 0o600);
		fs.unlinkSync(legacyPath);
	} catch (error) {
		if (fs.existsSync(currentPath)) fs.chmodSync(currentPath, 0o600);
		else throw error;
	}
}

export function requireCredentials(clientId: string, clientSecret: string, redirectUrl: string) {
	if (!clientId.trim() || !clientSecret.trim() || !redirectUrl.trim()) throw new Error("Missing OAuth credentials. Configure client ID, client secret, and redirect URL first.");
}
