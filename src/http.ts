export interface HttpRequest { url: string; method: string; headers?: Record<string, string>; body?: string; }
export interface HttpResponse<T = unknown> { status: number; json: T; text: string; }
export type HttpClient = <T = unknown>(request: HttpRequest) => Promise<HttpResponse<T>>;
