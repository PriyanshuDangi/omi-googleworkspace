export interface OmiToolRequestBody {
  uid?: string;
  app_id?: string;
  tool_name?: string;
  [key: string]: unknown;
}

export interface OmiResultResponse {
  result: string;
}

export interface OmiErrorResponse {
  error: string;
}
