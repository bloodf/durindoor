function isIntentionalWorkerHandoff(code, intentionalExitCode, hasStaleOwnership) {
  return Number.isInteger(code)
    && code === intentionalExitCode
    && hasStaleOwnership === false;
}

module.exports = {
  isIntentionalWorkerHandoff,
};
