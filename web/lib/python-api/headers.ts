export function pythonServiceHeaders(): Record<string, string> {
  const secret = process.env.PYTHON_SERVICE_SECRET;
  return secret ? { "x-internal-auth": secret } : {};
}
