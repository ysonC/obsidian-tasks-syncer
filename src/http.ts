export interface HttpRequest { url: string; method: string; headers?: Record<string, string>; body?: string; }
export interface HttpResponse<T = any> { status: number; json: T; text: string; }
export type HttpClient = <T = any>(request: HttpRequest) => Promise<HttpResponse<T>>;
