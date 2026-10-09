export function createApiClient() {
  let token;

  async function request(endpoint, input) {
    const response = await fetch(
      `/api/${endpoint}`,
      input === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-SCMaker-Token': token },
            body: JSON.stringify(input),
          },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }

  return {
    request,
    setToken(value) {
      token = value;
    },
  };
}
