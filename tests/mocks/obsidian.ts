export const requestUrl = async (): Promise<any> => { throw new Error("requestUrl mock not configured"); };
export class Notice {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class ItemView {}
export class Modal { open(): void {} }
export class FuzzySuggestModal<T> { declare readonly __itemType: T; open(): void {} }
export class TFile {}
export const setIcon = () => undefined;
