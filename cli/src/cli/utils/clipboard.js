const { execSync } = require("child_process");

/**
 * Copy text to clipboard based on OS
 * @param {string} text - Text to copy
 * @returns {boolean} Success status
 */
function copyToClipboard(text) {
  try {
    const platform = process.platform;
    
    if (platform === "darwin") {
      execSync("pbcopy", { input: text, windowsHide: true });
    } else if (platform === "win32") {
      execSync("clip", { input: text, windowsHide: true });
    } else {
      // Linux - try xclip first, then xsel
      try {
        execSync("xclip -selection clipboard", { input: text, windowsHide: true });
      } catch {
        execSync("xsel --clipboard --input", { input: text, windowsHide: true });
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = { copyToClipboard };
