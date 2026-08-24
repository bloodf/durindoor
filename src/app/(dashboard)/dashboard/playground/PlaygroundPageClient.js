"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, ProviderIcon, Select } from "@/shared/components";
import Pagination from "@/shared/components/Pagination";
import { getModelsByProviderId, isChatModel } from "@/shared/constants/models";
import { isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { createSseParser } from "@/lib/playground/sse";
import { sanitizeErrorText } from "@/lib/playground/errors";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { getConnectionOptions, getModelReasoningOptions, groupModelsByProvider, normalizeReasoningEffort, paginateSessions } from "./playgroundHelpers";
import { isBrowser, isObject, isString } from "../../../../shared/utils/typeChecks.js";

const STORAGE_KEYS = {
  sessions: "basic-chat.sessions",
  activeSessionId: "basic-chat.activeSessionId",
  activeProviderId: "basic-chat.activeProviderId",
  draft: "basic-chat.draft",
  reasoningEffort: "playground.reasoningEffort",
  activeConnectionId: "playground.activeConnectionId"
};

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function textValue(value) {
  if (isString(value)) return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (isObject(value)) {
    if (isString(value.message)) return value.message;
    if (isString(value.error)) return value.error;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function humanize(value = "") {
  return String(value).
  replace(/[-_]/g, " ").
  replace(/\b\w/g, (char) => char.toUpperCase()).
  trim() || "Unknown";
}

function formatRelativeTime(value) {
  if (!value) return "Now";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Now";
  const diffMinutes = Math.max(1, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.round(diffHours / 24)}d`;
}

function makeSessionTitle(text = "") {
  const normalized = textValue(text).replace(/\s+/g, " ").trim();
  if (!normalized) return "New chat";
  return normalized.length > 52 ? `${normalized.slice(0, 52).trimEnd()}…` : normalized;
}

function buildUserContent(message) {
  const text = textValue(message.content).trim();
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];

  if (attachments.length === 0) return text;

  const content = [];
  if (text) content.push({ type: "text", text });

  for (const attachment of attachments) {
    if (attachment?.dataUrl) {
      content.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
    }
  }

  return content.length > 0 ? content : text;
}

function readAssistantText(chunk) {
  if (!chunk || !isObject(chunk)) return "";
  const choice = chunk.choices?.[0];
  const delta = choice?.delta || {};
  const pieces = [delta.content, choice?.message?.content, chunk.output_text, chunk.text].
  map(textValue).
  filter(Boolean);
  return pieces[0] || "";
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function cloneSession(session) {
  return {
    ...session,
    messages: Array.isArray(session.messages) ? session.messages.map((message) => ({ ...message })) : []
  };
}

function getProviderLabel(connection) {
  return connection?.name || humanize(connection?.provider || connection?.id || "provider");
}

function normalizeStaticModel(model, connection) {
  if (!model?.id) return null;
  // Agent-only static models (e.g. Devin) are not chat candidates; skip them.
  if (!isChatModel(model)) return null;
  const providerId = connection.providerId || connection.provider || connection.id;
  return {
    id: `${providerId}/${model.id}`,
    requestModel: `${providerId}/${model.id}`,
    name: model.name || model.id,
    providerId,
    providerName: connection.providerName || getProviderLabel(connection),
    source: "static"
  };
}

function normalizeLiveModel(model, connection) {
  const rawId = isString(model) ? model : model?.id || model?.name || model?.model || "";
  if (!rawId) return null;

  const displayName = isString(model) ?
  model :
  model?.name || model?.displayName || rawId;

  const providerId = connection.providerId || connection.provider || connection.id;
  let requestModel = rawId;
  const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
  if (isCompatible && !rawId.includes("/")) {
    requestModel = `${providerId}/${rawId}`;
  }

  return {
    id: requestModel,
    requestModel,
    name: displayName,
    providerId,
    providerName: connection.providerName || getProviderLabel(connection),
    source: "live"
  };
}

function parseProviderModelsPayload(data) {
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

export default function PlaygroundPageClient() {
  const [providerGroups, setProviderGroups] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sessions, setSessions] = useState(() => {
    if (!isBrowser()) return [];
    try {
      const saved = safeParse(globalThis.localStorage.getItem(STORAGE_KEYS.sessions), []);
      return Array.isArray(saved) ? saved.map((session) => ({
        ...session,
        messages: Array.isArray(session.messages) ? session.messages : []
      })) : [];
    } catch {return [];}
  });
  const [activeSessionId, setActiveSessionId] = useState(() => {
    if (!isBrowser()) return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeSessionId) || "";
  });
  const [activeProviderId, setActiveProviderId] = useState(() => {
    if (!isBrowser()) return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeProviderId) || "";
  });
  const [activeModelId, setActiveModelId] = useState("");
  const [draft, setDraft] = useState(() => {
    if (!isBrowser()) return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.draft) || "";
  });
  const [reasoningEffort, setReasoningEffort] = useState(() => {
    if (!isBrowser()) return "auto";
    return globalThis.localStorage.getItem(STORAGE_KEYS.reasoningEffort) || "auto";
  });
  const [activeConnectionId, setActiveConnectionId] = useState(() => {
    if (!isBrowser()) return "auto";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeConnectionId) || "auto";
  });
  const [attachments, setAttachments] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const loadAbortRef = useRef(null);
  const initializedRef = useRef(false);
  const modelMenuRef = useRef(null);
  const historyMenuRef = useRef(null);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    async function loadData() {
      setLoadingData(true);
      setLoadError("");

      try {
        const providersRes = await fetch("/api/providers", { cache: "no-store", signal: controller.signal });
        const providersData = await providersRes.json().catch(() => ({}));
        const connections = Array.isArray(providersData.connections) ?
        providersData.connections.filter((connection) => connection?.isActive !== false) :
        [];

        if (connections.length === 0) {
          if (!cancelled) {
            setProviderGroups([]);
            setLoadError("No providers connected yet.");
          }
          return;
        }

        const liveResults = await Promise.all(
          connections.map(async (connection) => {
            try {
              const response = await fetch(`/api/providers/${connection.id}/models`, { cache: "no-store", signal: controller.signal });
              const data = await response.json().catch(() => ({}));
              if (!response.ok) return { connection, models: [] };
              const models = parseProviderModelsPayload(data).
              map((model) => normalizeLiveModel(model, connection)).
              filter(Boolean);
              return { connection, models };
            } catch {
              return { connection, models: [] };
            }
          })
        );

        const normalizedConnections = connections.map((connection) => {
          const providerId = connection.provider || connection.id;
          return {
            ...connection,
            provider: connection.provider || connection.id,
            providerId,
            providerName: getProviderLabel(connection),
            providerType: isOpenAICompatibleProvider(providerId) ?
            "openai-compatible" :
            isAnthropicCompatibleProvider(providerId) ?
            "anthropic-compatible" :
            providerId
          };
        });

        const normalizedModels = [
        ...normalizedConnections.flatMap((connection) =>
        getModelsByProviderId(connection.providerId).
        map((model) => normalizeStaticModel(model, connection)).
        filter(Boolean)
        ),
        ...liveResults.flatMap((result) => result.models || [])];


        const normalized = groupModelsByProvider(normalizedConnections, normalizedModels);

        if (!cancelled) {
          setProviderGroups(normalized);
          if (normalized.length === 0) {
            setLoadError("Providers connected but no models available.");
          }
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!cancelled) {
          setLoadError(sanitizeErrorText(error?.message) || "Failed to load providers/models.");
          setProviderGroups([]);
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
      controller.abort();
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setModelMenuOpen(false);
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(event.target)) {
        setHistoryOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Abort any in-flight chat request when the component unmounts so a
  // navigation away mid-stream can't setState on an unmounted tree.
  useEffect(() => () => abortRef.current?.abort(), []);

  const modelIndex = useMemo(() => {
    const map = new Map();
    for (const group of providerGroups) {
      for (const model of group.models) {
        map.set(model.id, {
          ...model,
          providerId: group.providerId,
          providerName: group.providerName
        });
      }
    }
    return map;
  }, [providerGroups]);

  const activeProviderGroup = useMemo(() => {
    return providerGroups.find((group) => group.providerId === activeProviderId) || providerGroups[0] || null;
  }, [providerGroups, activeProviderId]);

  const activeModel = useMemo(() => {
    if (activeModelId && modelIndex.has(activeModelId)) return modelIndex.get(activeModelId);
    if (activeSessionId) {
      const session = sessions.find((item) => item.id === activeSessionId);
      if (session?.modelId && modelIndex.has(session.modelId)) return modelIndex.get(session.modelId);
    }
    return activeProviderGroup?.models?.[0] || null;
  }, [activeModelId, modelIndex, activeProviderGroup, sessions, activeSessionId]);

  const reasoningOptions = useMemo(() => {
    if (!activeModel) return null;
    return getModelReasoningOptions(activeModel.providerId, activeModel.requestModel, { getThinkingLevels });
  }, [activeModel]);

  useEffect(() => {
    setReasoningEffort((prev) => normalizeReasoningEffort(reasoningOptions, prev));
  }, [reasoningOptions]);

  const currentSession = useMemo(() => sessions.find((session) => session.id === activeSessionId) || null, [sessions, activeSessionId]);
  const currentMessages = currentSession?.messages || [];
  const sessionItems = useMemo(() => [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [sessions]);
  const paginatedSessions = useMemo(() => paginateSessions(sessionItems, historyPage, 10), [sessionItems, historyPage]);

  // Keep the history page valid as sessions change: reset to page 1 when the
  // list grows (new chat pushed to the top), clamp to the last page when it
  // shrinks (deletions). Renders use the clamped value from paginatedSessions;
  // this effect keeps state in sync.
  const prevSessionCountRef = useRef(sessionItems.length);
  useEffect(() => {
    const prev = prevSessionCountRef.current;
    prevSessionCountRef.current = sessionItems.length;
    if (sessionItems.length > prev) {
      if (historyPage !== 1) setHistoryPage(1);
    } else if (historyPage !== paginatedSessions.page) {
      setHistoryPage(paginatedSessions.page);
    }
  }, [sessionItems.length, historyPage, paginatedSessions.page]);
  const canSend = !isSending && !!activeModel && (draft.trim().length > 0 || attachments.length > 0);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      globalThis.localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
      globalThis.localStorage.setItem(STORAGE_KEYS.activeSessionId, activeSessionId);
      globalThis.localStorage.setItem(STORAGE_KEYS.activeProviderId, activeProviderId);
      globalThis.localStorage.setItem(STORAGE_KEYS.draft, draft);
      globalThis.localStorage.setItem(STORAGE_KEYS.reasoningEffort, reasoningEffort);
      globalThis.localStorage.setItem(STORAGE_KEYS.activeConnectionId, activeConnectionId);
    } catch {

      // Ignore storage errors.
    }}, [isHydrated, sessions, activeSessionId, activeProviderId, draft, reasoningEffort, activeConnectionId]);

  useEffect(() => {
    if (!isHydrated || loadingData || initializedRef.current) return;
    if (providerGroups.length === 0) return;

    const savedProvider = providerGroups.find((group) => group.providerId === activeProviderId) || providerGroups[0];
    const savedModel = activeModelId && modelIndex.has(activeModelId) ?
    modelIndex.get(activeModelId) :
    savedProvider.models[0];

    if (sessions.length > 0) {
      const session = sessions.find((item) => item.id === activeSessionId) || sessions[0];
      const sessionModel = session?.modelId && modelIndex.has(session.modelId) ?
      modelIndex.get(session.modelId) :
      savedModel;
      initializedRef.current = true;
      setActiveSessionId(session.id);
      setActiveProviderId(sessionModel?.providerId || savedProvider.providerId);
      setActiveModelId(sessionModel?.id || savedModel.id);
      return;
    }

    const session = {
      id: createId(),
      title: "New chat",
      providerId: savedProvider.providerId,
      providerName: savedProvider.providerName,
      modelId: savedModel.id,
      modelName: savedModel.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };

    initializedRef.current = true;
    setSessions([session]);
    setActiveSessionId(session.id);
    setActiveProviderId(savedProvider.providerId);
    setActiveModelId(savedModel.id);
  }, [isHydrated, loadingData, providerGroups, modelIndex, sessions, activeSessionId, activeProviderId, activeModelId]);

  const updateSession = (sessionId, updater) => {
    setSessions((prev) => prev.map((session) => session.id === sessionId ? updater(cloneSession(session)) : session));
  };

  const ensureSessionForModel = (model) => {
    if (!model) return null;
    return {
      id: createId(),
      title: "New chat",
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };
  };

  const handleNewChat = () => {
    if (!activeModel) return;
    const session = ensureSessionForModel(activeModel);
    if (!session) return;
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setActiveProviderId(session.providerId);
    setActiveModelId(session.modelId);
    setDraft("");
    setAttachments([]);
    setStreamingMessageId("");
    setStreamingText("");
  };

  const handleSelectSession = (sessionId) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    setActiveProviderId(session.providerId || activeProviderId);
    setActiveModelId(session.modelId || activeModelId);
    setHistoryOpen(false);
  };

  const handleDeleteCurrentChat = () => {
    if (!activeSessionId) return;
    const nextSessions = sessions.filter((session) => session.id !== activeSessionId);
    const fallback = nextSessions[0] || null;
    setSessions(nextSessions);
    if (fallback) {
      setActiveSessionId(fallback.id);
      setActiveProviderId(fallback.providerId);
      setActiveModelId(fallback.modelId);
    } else {
      setActiveSessionId("");
      setActiveProviderId("");
      setActiveModelId("");
    }
  };

  const handleSelectProvider = (providerId) => {
    const group = providerGroups.find((item) => item.providerId === providerId);
    if (!group || group.models.length === 0) return;
    const nextModel = group.models[0];
    setActiveConnectionId("auto");

    const current = sessions.find((session) => session.id === activeSessionId);
    if (current && current.messages.length > 0) {
      const session = ensureSessionForModel(nextModel);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    } else if (current) {
      setSessions((prev) => prev.map((item) => item.id === current.id ? {
        ...item,
        providerId: group.providerId,
        providerName: group.providerName,
        modelId: nextModel.id,
        modelName: nextModel.name
      } : item));
      setActiveSessionId(current.id);
    }

    setActiveProviderId(group.providerId);
    setActiveModelId(nextModel.id);
    setModelMenuOpen(false);
  };

  const handleSelectModel = (modelId) => {
    const model = modelIndex.get(modelId);
    if (!model) return;
    setActiveConnectionId("auto");

    const current = sessions.find((session) => session.id === activeSessionId);
    if (current && current.messages.length > 0) {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    } else if (current) {
      setSessions((prev) => prev.map((item) => item.id === current.id ? {
        ...item,
        providerId: model.providerId,
        providerName: model.providerName,
        modelId: model.id,
        modelName: model.name
      } : item));
      setActiveSessionId(current.id);
    } else {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    }

    setActiveProviderId(model.providerId);
    setActiveModelId(model.id);
    setModelMenuOpen(false);
  };

  const handleAttachFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      event.target.value = "";
      return;
    }

    const converted = await Promise.all(images.map(async (file) => ({
      id: createId(),
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: await fileToDataUrl(file)
    })));

    setAttachments((prev) => [...prev, ...converted]);
    event.target.value = "";
  };

  const removeAttachment = (attachmentId) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const finalizeSessionTitle = (sessionId, titleSeed) => {
    const title = makeSessionTitle(titleSeed);
    updateSession(sessionId, (session) => ({
      ...session,
      title: session.title === "New chat" ? title : session.title,
      updatedAt: new Date().toISOString()
    }));
  };

  const sendMessage = async () => {
    const model = activeModel || activeProviderGroup?.models?.[0] || null;
    if (!model) return;

    const userText = draft.trim();
    if (!userText && attachments.length === 0) return;

    let sessionId = activeSessionId;
    let session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      session = ensureSessionForModel(model);
      if (!session) return;
      sessionId = session.id;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(sessionId);
    }

    const userMessage = {
      id: createId(),
      role: "user",
      content: userText,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        dataUrl: attachment.dataUrl
      })),
      createdAt: new Date().toISOString()
    };

    const assistantMessageId = createId();
    const assistantMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "streaming"
    };

    const nextMessages = [...(session.messages || []), userMessage, assistantMessage];
    setSessions((prev) => prev.map((item) => item.id === sessionId ? {
      ...item,
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      messages: nextMessages,
      updatedAt: new Date().toISOString(),
      title: item.title === "New chat" ? makeSessionTitle(userText) : item.title
    } : item));
    setDraft("");
    setAttachments([]);
    setIsSending(true);
    setStreamingMessageId(assistantMessageId);
    setStreamingText("");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const requestMessages = nextMessages.
    filter((message) => !(message.role === "assistant" && message.id === assistantMessageId)).
    map((message) => ({
      role: message.role,
      content: message.role === "user" ? buildUserContent(message) : message.content
    }));

    try {
      const body = {
        model: model.requestModel || model.id,
        messages: requestMessages,
        stream: true
      };
      if (reasoningEffort !== "auto") {
        body.reasoning_effort = reasoningEffort;
      }

      const headers = {
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      };
      if (connectionValue !== "auto") {
        headers["x-connection-id"] = connectionValue;
      }

      const response = await fetch("/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(textValue(errorData.error || errorData.message || `Request failed (${response.status})`));
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const data = await response.json().catch(() => ({}));
        const fallbackText = textValue(data?.choices?.[0]?.message?.content || data?.output_text || data?.error || data?.message || "");
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => message.id === assistantMessageId ? { ...message, content: fallbackText, status: "done" } : message),
          updatedAt: new Date().toISOString()
        }));
        return;
      }

      const decoder = new TextDecoder();
      let assistantText = "";

      const parser = createSseParser(({ data }) => {
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          return; // Ignore malformed chunks.
        }
        const text = readAssistantText(chunk);
        if (!text) return;

        assistantText += text;
        setStreamingText(assistantText);
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => message.id === assistantMessageId ? { ...message, content: assistantText, status: "streaming" } : message),
          updatedAt: new Date().toISOString()
        }));
      });

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode()); // flush any pending multibyte fragment
      parser.flush();

      updateSession(sessionId, (currentSession) => ({
        ...currentSession,
        messages: currentSession.messages.map((message) => message.id === assistantMessageId ? { ...message, content: assistantText || message.content, status: "done" } : message),
        updatedAt: new Date().toISOString()
      }));
      finalizeSessionTitle(sessionId, userText);
    } catch (error) {
      if (error.name !== "AbortError") {
        const errorText = sanitizeErrorText(error?.message || error);
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => message.id === assistantMessageId ? { ...message, content: message.content || `Error: ${errorText}`, status: "error" } : message),
          updatedAt: new Date().toISOString()
        }));
        setLoadError(errorText || "Failed to send message.");
      }
    } finally {
      setIsSending(false);
      setStreamingMessageId("");
      setStreamingText("");
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) sendMessage();
    }
  };

  const modelLabel = activeModel ? `${activeModel.name}` : "Select model";
  const modelSubLabel = activeModel ? activeModel.requestModel : "Choose from connected providers";
  const activeConnectionOptions = useMemo(() => getConnectionOptions(activeProviderGroup), [activeProviderGroup]);

  const connectionValue = activeConnectionOptions.some((opt) => opt.value === activeConnectionId) ?
  activeConnectionId :
  "auto";

  return (
    <div className="relative flex flex-1 flex-col h-full min-h-0 min-w-0 overflow-hidden bg-bg text-text">
      <div className="relative mx-auto flex h-full min-h-0 w-full max-w-4xl flex-1 flex-col">
        {/* ---------- Toolbar ---------- */}
        <header className="sticky top-0 z-20 shrink-0 border-b border-border-subtle bg-bg/85 px-3 py-3 backdrop-blur-md sm:px-4 lg:px-6">
          <div className="flex flex-wrap items-center gap-3">
            {/* Model selector */}
            <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
              <span className="px-0.5 text-xs font-medium text-text-muted">Model</span>
              <div ref={modelMenuRef} className="relative min-w-0">
              <button
                  type="button"
                  onClick={() => setModelMenuOpen((value) => !value)}
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                  className="flex h-[52px] w-full items-center gap-3 rounded-[12px] border border-border bg-surface px-3 py-2.5 text-left transition hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:w-auto">
                  
                {activeProviderGroup ?
                  <ProviderIcon
                    src={`/providers/${activeProviderGroup.providerId}.png`}
                    alt={activeProviderGroup.providerName}
                    size={28}
                    className="shrink-0 rounded-[8px] object-contain"
                    fallbackText={activeProviderGroup.providerId.slice(0, 2).toUpperCase()} /> :


                  <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 text-text-muted">
                    <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                  </span>
                  }
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-text">{modelLabel}</span>
                    <span className="material-symbols-outlined shrink-0 text-[18px] text-text-muted">expand_more</span>
                  </span>
                  <span className="block truncate text-xs text-text-muted">{modelSubLabel}</span>
                </span>
              </button>

              {modelMenuOpen ?
                <Card
                  padding="none"
                  className="absolute left-0 top-[calc(100%+8px)] z-30 w-[min(520px,calc(100vw-1.5rem))] shadow-[var(--shadow-elev)]">
                  
                  <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-subtle">Models</p>
                      <p className="text-xs text-text-muted">From connected providers</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setModelMenuOpen(false)}
                      className="rounded-full p-1 text-text-muted transition hover:bg-surface-2 hover:text-text"
                      aria-label="Close model list">
                      
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                  <div className="max-h-[60vh] space-y-2 overflow-y-auto p-2 custom-scrollbar">
                    {providerGroups.map((group) =>
                    <div key={group.providerId} className="rounded-[12px] border border-border-subtle bg-bg p-2">
                        <div className="flex items-center justify-between px-1.5 py-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <ProviderIcon
                            src={`/providers/${group.providerId}.png`}
                            alt={group.providerName}
                            size={20}
                            className="shrink-0 rounded-[6px] object-contain"
                            fallbackText={group.providerId.slice(0, 2).toUpperCase()} />
                          
                            <p className="truncate text-sm font-semibold text-text">{group.providerName}</p>
                          </div>
                          <Badge size="sm" variant="default">{group.models.length}</Badge>
                        </div>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {group.models.map((model) => {
                          const isActive = model.id === activeModelId;
                          return (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => handleSelectModel(model.id)}
                              aria-pressed={isActive}
                              className={`rounded-[10px] border px-3 py-2.5 text-left transition ${isActive ? "border-brand-500/50 bg-brand-500/10" : "border-border-subtle bg-surface hover:bg-surface-2 hover:border-border"}`}>
                              
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-text">{model.name}</p>
                                    <p className="truncate text-[11px] text-text-muted">{model.requestModel}</p>
                                  </div>
                                  {isActive ? <span className="material-symbols-outlined shrink-0 text-[18px] text-brand-500">check_circle</span> : null}
                                </div>
                              </button>);

                        })}
                        </div>
                      </div>
                    )}
                  </div>
                </Card> :
                null}
              </div>
            </div>

            {/* Secondary controls */}
            <div className="flex flex-wrap items-center gap-2">
              {activeConnectionOptions.length > 1 ?
              <Select
                label="Connection"
                selectClassName="min-w-[10rem]"
                options={activeConnectionOptions}
                value={connectionValue}
                onChange={(event) => setActiveConnectionId(event.target.value)}
                placeholder="Select connection" /> :

              null}
              {reasoningOptions && reasoningOptions.length > 1 ?
              <Select
                label="Effort"
                aria-label="Reasoning effort"
                selectClassName="h-[46px] min-w-[9rem] py-2.5"
                options={reasoningOptions.map((option) => ({ value: option, label: humanize(option) }))}
                value={reasoningEffort}
                onChange={(event) => setReasoningEffort(event.target.value)}
                placeholder="Effort" /> :

              null}
              <Button
                variant="outline"
                size="sm"
                icon="history"
                onClick={() => setHistoryOpen((value) => !value)}
                aria-expanded={historyOpen}
                aria-haspopup="dialog">
                
                History
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="delete"
                onClick={handleDeleteCurrentChat}
                disabled={!activeSessionId || sessions.length === 0}>
                
                Clear
              </Button>
            </div>
          </div>
        </header>

        {/* ---------- History popover ---------- */}
        {historyOpen ?
        <Card
          padding="none"
          className="absolute right-3 top-[68px] z-30 w-[min(360px,calc(100vw-1.5rem))] shadow-[var(--shadow-elev)] sm:right-4 lg:right-6">
          
            <div className="flex items-center justify-between px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-subtle">Recent chats</p>
              <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="rounded-full p-1 text-text-muted transition hover:bg-surface-2 hover:text-text"
              aria-label="Close history">
              
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
            <div className="max-h-[48vh] space-y-1.5 overflow-y-auto p-1.5 custom-scrollbar">
              {sessionItems.length === 0 ?
            <div className="rounded-[10px] border border-dashed border-border-subtle bg-surface p-4 text-sm text-text-muted">
                  No conversations yet.
                </div> :
            paginatedSessions.items.map((session) => {
              const isActive = session.id === activeSessionId;
              const latestMessage = [...(session.messages || [])].reverse().find((message) => message.role === "user") || session.messages?.[0];
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => handleSelectSession(session.id)}
                  aria-pressed={isActive}
                  className={`w-full rounded-[10px] border px-3 py-2.5 text-left transition ${isActive ? "border-brand-500/50 bg-brand-500/10" : "border-border-subtle bg-surface hover:bg-surface-2 hover:border-border"}`}>
                  
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text">{session.title}</p>
                        <p className="mt-0.5 truncate text-xs text-text-muted">{textValue(latestMessage?.content) || "Empty chat"}</p>
                      </div>
                      <span className="shrink-0 text-[10px] text-text-subtle">{formatRelativeTime(session.updatedAt)}</span>
                    </div>
                  </button>);

            })}
            </div>
            {sessionItems.length > paginatedSessions.items.length ?
          <div className="border-t border-border-subtle px-2 py-1">
                <Pagination
              currentPage={paginatedSessions.page}
              pageSize={10}
              totalItems={sessionItems.length}
              onPageChange={setHistoryPage} />
            
              </div> :
          null}
          </Card> :
        null}

        {/* ---------- Load error ---------- */}
        {loadError ?
        <div className="mx-3 mt-3 rounded-[12px] border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200 sm:mx-4 lg:mx-6">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined mt-0.5 text-[18px] text-red-600 dark:text-red-300">error</span>
              <p className="leading-6">{loadError}</p>
            </div>
          </div> :
        null}

        {/* ---------- Thread + composer ---------- */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-3 py-4 custom-scrollbar sm:px-4 lg:px-6">
            {currentMessages.length === 0 ?
            <div className="flex min-h-[50vh] items-center justify-center px-4 text-center">
                <div className="max-w-xl space-y-4">
                  <div className="mx-auto flex size-16 items-center justify-center rounded-[20px] border border-border-subtle bg-surface text-brand-500">
                    <span className="material-symbols-outlined text-[32px]">forum</span>
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold text-text">Playground</h2>
                    <p className="text-sm leading-6 text-text-muted">
                      Chat against the local /v1 endpoint with any model from connected providers. Select a model and start streaming.
                    </p>
                    {activeModel ?
                  <p className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-3 py-1 text-xs font-medium text-text-muted">
                        <span className="size-1.5 rounded-full bg-brand-500" />
                        {activeProviderGroup?.providerName || activeModel.providerName} · {activeModel.name}
                      </p> :
                  null}
                  </div>
                </div>
              </div> :
            null}

            <ol className="mx-auto flex w-full max-w-3xl flex-col gap-5">
              {currentMessages.map((message) => {
                const isUser = message.role === "user";
                const isAssistant = message.role === "assistant";
                const isStreaming = isAssistant && message.id === streamingMessageId && message.status === "streaming";
                const isError = message.status === "error";
                const content = textValue(message.content) || (isAssistant ? streamingText : "");
                const assistantName = activeModel?.name || "Assistant";

                return (
                  <li
                    key={message.id}
                    className={`flex w-full gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
                    
                    {/* Avatar (assistant only) */}
                    {!isUser ?
                    <span
                      className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-border-subtle bg-surface"
                      aria-hidden="true">
                      
                        {activeProviderGroup ?
                      <ProviderIcon
                        src={`/providers/${activeProviderGroup.providerId}.png`}
                        alt=""
                        size={20}
                        className="rounded object-contain"
                        fallbackText={activeProviderGroup.providerId.slice(0, 2).toUpperCase()} /> :


                      <span className="material-symbols-outlined text-[18px] text-text-muted">smart_toy</span>
                      }
                      </span> :
                    null}

                    <div className={`flex min-w-0 max-w-[min(88%,42rem)] flex-col ${isUser ? "items-end" : "items-start"}`}>
                      {/* Role label */}
                      <div className={`mb-1 flex items-center gap-2 px-1 ${isUser ? "flex-row-reverse" : ""}`}>
                        <span className="text-xs font-semibold text-text">{isUser ? "You" : assistantName}</span>
                        {isStreaming ?
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-medium text-brand-500">
                            <span className="size-1.5 animate-pulse rounded-full bg-brand-500" />
                            streaming
                          </span> :
                        null}
                        {isError ?
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-300">
                            <span className="material-symbols-outlined text-[12px]">error</span>
                            error
                          </span> :
                        null}
                      </div>

                      {/* Attachments */}
                      {message.attachments?.length ?
                      <div className={`mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3 ${isUser ? "justify-items-end" : ""}`}>
                          {message.attachments.map((attachment) =>
                        <a
                          key={attachment.id}
                          href={attachment.dataUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-[12px] border border-border-subtle bg-surface transition hover:border-brand-500/40">
                          
                              <img src={attachment.dataUrl} alt={attachment.name} className="h-28 w-full object-cover" />
                            </a>
                        )}
                        </div> :
                      null}

                      {/* Bubble */}
                      <div
                        className={`w-full whitespace-pre-wrap break-words rounded-[16px] px-4 py-3 text-[15px] leading-7 transition-colors ${
                        isUser ?
                        "rounded-tr-sm bg-brand-500/10 text-text" :
                        isError ?
                        "rounded-tl-sm border border-red-500/25 bg-red-500/5 text-text" :
                        "rounded-tl-sm border border-border-subtle bg-surface text-text"}`
                        }>
                        
                        {content}
                        {isAssistant && isStreaming && !streamingText ?
                        <span className="ml-0.5 inline-block animate-pulse text-text-muted">▋</span> :
                        null}
                      </div>
                    </div>
                  </li>);

              })}
            </ol>
          </div>

          {/* ---------- Composer ---------- */}
          <div className="shrink-0 border-t border-border-subtle bg-bg/85 px-3 py-3 backdrop-blur-md sm:px-4 lg:px-6">
            {attachments.length > 0 ?
            <div className="mx-auto mb-2.5 flex w-full max-w-3xl flex-wrap gap-2">
                {attachments.map((attachment) =>
              <div
                key={attachment.id}
                className="group flex items-center gap-2 rounded-full border border-border-subtle bg-surface py-1 pl-2 pr-1">
                
                    <img
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  className="size-7 rounded-full object-cover" />
                
                    <span className="max-w-[10rem] truncate text-xs text-text">{attachment.name}</span>
                    <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  className="flex size-6 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-2 hover:text-text"
                  aria-label={`Remove ${attachment.name}`}>
                  
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
              )}
              </div> :
            null}

            <div className="mx-auto w-full max-w-3xl">
              <div className="rounded-[16px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] transition focus-within:border-brand-500/40 focus-within:shadow-[var(--shadow-focus)]">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${activeModel?.name || "model"}`}
                  rows={1}
                  aria-label="Message input"
                  className="max-h-[25vh] w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 text-[15px] leading-6 text-text outline-none placeholder:text-text-muted custom-scrollbar" />
                

                <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
                  <div className="flex min-w-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!activeModel || loadingData}
                      className="flex size-9 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Attach image"
                      title="Attach image">
                      
                      <span className="material-symbols-outlined text-[20px]">attach_file</span>
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAttachFiles} />
                    <span className="truncate pl-1 text-xs font-medium text-text-subtle">
                      {activeModel ? activeModel.name : "No model"}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {isSending ?
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      icon="stop"
                      onClick={handleStop}>
                      
                        Stop
                      </Button> :
                    null}
                    <button
                      type="button"
                      onClick={sendMessage}
                      disabled={!canSend}
                      aria-label="Send message"
                      className={`flex size-9 items-center justify-center rounded-full transition ${
                      canSend ?
                      "bg-brand-500 text-white hover:bg-brand-600 active:scale-95" :
                      "cursor-not-allowed bg-surface-3 text-text-subtle"}`
                      }>
                      
                      <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                    </button>
                  </div>
                </div>
              </div>

              <p className="mt-2 px-1 text-center text-[11px] text-text-subtle">
                Enter to send · Shift+Enter for newline · Model list is filtered from connected providers.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>);

}