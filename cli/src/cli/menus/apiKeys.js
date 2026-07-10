const api = require("../api/client");
const { prompt, select, confirm, pause } = require("../utils/input");
const { clearScreen, showStatus, showHeader } = require("../utils/display");
const { formatDate, getRelativeTime } = require("../utils/format");
const { showMenuWithBack } = require("../utils/menuHelper");
const { copyToClipboard } = require("../utils/clipboard");
const { getEndpoint } = require("../utils/endpoint");
const { EXPIRY_OPTIONS, expiryFromChoice, formatExpiry: formatExpiryValue } = require("../utils/apiKeyExpiry");

function formatExpiry(expiresAt) {
  return formatExpiryValue(expiresAt, Date.now(), formatDate);
}

async function promptExpiry() {
  const index = await select("Choose expiry", EXPIRY_OPTIONS.map((opt) => opt.label));
  const choice = EXPIRY_OPTIONS[index];
  if (choice?.value !== "custom") return expiryFromChoice(choice, null);
  while (true) {
    const raw = await prompt("Enter local expiry (YYYY-MM-DDTHH:MM): ");
    try {
      return expiryFromChoice(choice, raw);
    } catch (error) {
      showStatus(error.message, "error");
    }
  }
}

/**
 * Display API keys list with formatted output
 * @param {Array} keys - Array of API key objects
 * @param {number} port - Server port
 */
function displayApiKeys(keys, port) {
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│  🔑 API Keys Management                                 │");
  console.log("├─────────────────────────────────────────────────────────┤");
  // Note: This function is legacy, endpoint shown in menu header instead
  console.log("│                                                          │");
  
  if (keys.length === 0) {
    console.log("│  No API keys found.                                     │");
  } else {
    console.log(`│  Your API Keys (${keys.length}):${" ".repeat(42 - String(keys.length).length)}│`);
    
    keys.forEach((key, index) => {
      console.log("│                                                          │");
      console.log(`│  ${index + 1}. ${key.name}${" ".repeat(52 - String(index + 1).length - key.name.length)}│`);
      
      const maskedKey = key.maskedKey || "***";
      console.log(`│     Key: ${maskedKey}${" ".repeat(47 - maskedKey.length)}│`);
      
      const created = formatDate(key.createdAt);
      console.log(`│     Created: ${created}${" ".repeat(43 - created.length)}│`);

      const expiry = formatExpiry(key.expiresAt);
      console.log(`│     Expiry: ${expiry}${" ".repeat(Math.max(0, 44 - expiry.length))}│`);

      if (key.lastUsedAt) {
        const lastUsed = getRelativeTime(key.lastUsedAt);
        console.log(`│     Last used: ${lastUsed}${" ".repeat(41 - lastUsed.length)}│`);
      } else {
        console.log("│     Last used: Never                                    │");
      }
    });
  }
  
  console.log("│                                                          │");
  console.log("│  Actions:                                               │");
  console.log("│  1. Create New API Key                                  │");
  console.log("│  2. Edit Key Expiry (by number)                         │");
  console.log("│  3. Delete Key (by number)                              │");
  console.log("│  0. ← Back to Main Menu                                 │");
  console.log("└─────────────────────────────────────────────────────────┘");
}

/**
 * Handle creating new API key
 * @returns {Promise<boolean>} Success status
 */
async function handleCreateKey() {
  console.log("\n📝 Create New API Key");
  console.log("─".repeat(30));
  
  const name = await prompt("Enter key name: ");

  if (!name) {
    showStatus("Key name cannot be empty", "error");
    await pause();
    return false;
  }

  const expiresAt = await promptExpiry();
  const result = await api.createApiKey(name, expiresAt);
  
  if (!result.success) {
    showStatus(`Failed to create key: ${result.error}`, "error");
    await pause();
    return false;
  }
  
  console.log("\n✅ API Key created successfully!");
  console.log("\n⚠️  IMPORTANT: Save this key now. You won't be able to see it again!");
  console.log(`\nKey: ${result.data.key}`);
  console.log(`Name: ${result.data.name}`);
  console.log(`ID: ${result.data.id}`);
  console.log(`Expiry: ${formatExpiry(result.data.expiresAt)}`);
  
  const shouldCopy = await confirm("\nCopy key to clipboard?");
  if (shouldCopy) {
    if (copyToClipboard(result.data.key)) {
      showStatus("Key copied to clipboard!", "success");
    } else {
      showStatus("Failed to copy to clipboard", "error");
    }
  }
  
  await pause();
  return true;
}

async function handleEditExpiry(key) {
  console.log(`\n✏️  Edit Expiry: ${key.name}`);
  console.log(`Current: ${formatExpiry(key.expiresAt)}`);
  const expiresAt = await promptExpiry();
  const result = await api.updateApiKey(key.id, { expiresAt });
  showStatus(
    result.success ? `Expiry updated: ${formatExpiry(result.data.key?.expiresAt)}` : `Failed to update expiry: ${result.error}`,
    result.success ? "success" : "error",
  );
  await pause();
  return result.success;
}

/**
 * Handle deleting API key
 * @param {Object} key - API key object
 * @returns {Promise<boolean>} Success status
 */
async function handleDeleteKey(key) {
  console.log(`\n⚠️  Delete API Key: ${key.name}`);
  console.log("─".repeat(30));
  console.log(`Key: ${key.maskedKey || "***"}`);
  console.log(`Expiry: ${formatExpiry(key.expiresAt)}`);
  console.log(`Created: ${formatDate(key.createdAt)}`);
  
  const confirmed = await confirm("\nAre you sure you want to delete this key?");
  
  if (!confirmed) {
    showStatus("Deletion cancelled", "info");
    await pause();
    return false;
  }
  
  const result = await api.deleteApiKey(key.id);
  
  if (!result.success) {
    showStatus(`Failed to delete key: ${result.error}`, "error");
    await pause();
    return false;
  }
  
  showStatus("API key deleted successfully", "success");
  await pause();
  return true;
}

/**
 * Show actions for a specific key
 * @param {Object} key - API key object
 * @param {number} port - Server port
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showKeyActions(key, port, breadcrumb = []) {
  const { endpoint } = await getEndpoint(port);
  await showMenuWithBack({
    title: `🔑 ${key.name}`,
    breadcrumb: [...breadcrumb, key.name],
    headerContent: `Name: ${key.name}\nKey: ${key.maskedKey || "***"}\nExpiry: ${formatExpiry(key.expiresAt)}\nEndpoint: ${endpoint}\nSecret: shown only at creation`,
    items: [
      {
        label: "Edit Expiry",
        action: async () => {
          await handleEditExpiry(key);
          return true;
        }
      },
      {
        label: "Delete Key",
        action: async () => {
          await handleDeleteKey(key);
          return false; // Exit after delete
        }
      }
    ]
  });
}

/**
 * Main API Keys menu
 * @param {number} port - Server port number
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showApiKeysMenu(port, breadcrumb = []) {
  const { showListMenu } = require("../utils/menuHelper");
  
  const { endpoint } = await getEndpoint(port);
  await showListMenu({
    title: "🔑 API Keys Management",
    breadcrumb,
    headerContent: `Endpoint: ${endpoint}`,
    fetchItems: async () => {
      const result = await api.getApiKeys();
      if (!result.success) {
        clearScreen();
        showStatus(`Failed to fetch API keys: ${result.error}`, "error");
        await pause();
        return null;
      }
      return { items: result.data.keys || [] };
    },
    formatItem: (key) => `${key.name} (${key.maskedKey || "***"}) — ${formatExpiry(key.expiresAt)}`,
    onSelect: async (key) => {
      await showKeyActions(key, port, breadcrumb);
    },
    createAction: {
      label: "Create New API Key",
      action: async () => {
        await handleCreateKey();
      }
    }
  });
}

module.exports = {
  showApiKeysMenu
};
