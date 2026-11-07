const USAGE = "Usage: durindoor admin combos get <id> [--port <port>]";

/** Read one local combo using the existing CLI management authorization.
 * JSON data goes to stdout; errors go to stderr. Exit: 0 success, 1 API,
 * 2 usage. Validate arguments before loading the client or touching auth state.
 */
async function runAdmin(args, { loadApi = () => require("./api/client"), stdout = console.log, stderr = console.error } = {}) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    stdout(USAGE);
    return 0;
  }
  const [resource, action, id, flag, portText] = args;
  const port = portText === undefined ? 20128 : Number(portText);
  if (resource !== "combos" || action !== "get" || !id || id.startsWith("-") ||
      [".", ".."].includes(id) || ![3, 5].includes(args.length) ||
      (args.length === 5 && (flag !== "--port" || !/^\d+$/.test(portText))) ||
      !Number.isInteger(port) || port < 1 || port > 65535) {
    stderr(JSON.stringify({ error: USAGE }));
    return 2;
  }
  const api = loadApi();
  api.configure({ host: "127.0.0.1", protocol: "http:", port });
  const result = await api.getComboById(id);
  if (!result.success) {
    const failure = { error: result.error };
    if (result.statusCode) failure.statusCode = result.statusCode;
    stderr(JSON.stringify(failure));
    return 1;
  }
  stdout(JSON.stringify(result.data));
  return 0;
}

module.exports = { runAdmin };
