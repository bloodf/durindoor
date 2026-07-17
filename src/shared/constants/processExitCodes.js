// Reserved worker exit codes shared by the standalone server and its CLI parent.
// A normal code 0 remains restartable because an unexplained clean worker exit
// must not silently abandon MITM ownership.
const INTENTIONAL_HANDOFF_EXIT_CODE = 75;

module.exports = Object.freeze({
  INTENTIONAL_HANDOFF_EXIT_CODE,
});
