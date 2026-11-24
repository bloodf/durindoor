function setStatusCorsHeaders(req, res, appPort) {
  res.setHeader("Vary", "Origin");
  const origin = req.headers.origin;
  if (origin === `http://localhost:${appPort}` || origin === `http://127.0.0.1:${appPort}`) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
}

module.exports = { setStatusCorsHeaders };
