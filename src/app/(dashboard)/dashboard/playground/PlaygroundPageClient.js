"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Card } from "@/shared/ui/components/Card.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import Pagination from "@/shared/ui/components/Pagination.jsx";
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
  const [activeModelIndex, setActiveModelIndex] = useState(-1);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const loadAbortRef = useRef(null);
  const initializedRef = useRef(false);
  const modelMenuRef = useRef(null);
  const modelTriggerRef = useRef(null);
  const modelListboxId = useId();
  const modelLabelId = useId();
  const modelValueId = useId();
  const historyMenuRef = useRef(null);
  const historyTriggerRef = useRef(null);

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
            if (!connection || connection.canDiscoverModels === false) {
              return { connection, models: [] };
            }
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
      if (historyMenuRef.current && !historyMenuRef.current.contains(event.target) && !historyTriggerRef.current?.contains(event.target)) {
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
  const modelOptions = useMemo(() => providerGroups.flatMap((group) => group.models), [providerGroups]);
  const selectedModelIndex = Math.max(0, modelOptions.findIndex((model) => model.id === activeModel?.id));
  const openModelMenu = () => {
    setActiveModelIndex(selectedModelIndex);
    setModelMenuOpen(true);
  };
  const closeModelMenu = () => {
    setModelMenuOpen(false);
    modelTriggerRef.current?.focus();
  };
  const handleModelListKeyDown = (event) => {
    if (modelOptions.length === 0) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModelMenu();
      return;
    }
    let nextIndex = activeModelIndex < 0 ? selectedModelIndex : activeModelIndex;
    if (event.key === "ArrowDown") nextIndex = (nextIndex + 1) % modelOptions.length;
    else if (event.key === "ArrowUp") nextIndex = (nextIndex - 1 + modelOptions.length) % modelOptions.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = modelOptions.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleSelectModel(modelOptions[nextIndex].id);
      modelTriggerRef.current?.focus();
      return;
    } else return;
    event.preventDefault();
    setActiveModelIndex(nextIndex);
  };
  const handleModelTriggerKeyDown = (event) => {
    if (modelMenuOpen) {
      handleModelListKeyDown(event);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveModelIndex(event.key === "ArrowDown" ? selectedModelIndex : Math.max(0, modelOptions.length - 1));
      setModelMenuOpen(true);
    }
  };

  return (
    <main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-dd-bg text-dd-text" aria-label="Model playground">
      <section className="relative mx-auto flex h-full min-h-0 w-full max-w-5xl flex-1 flex-col border-x border-dd-border-subtle bg-dd-bg-alt">
        <header className="sticky top-0 z-20 shrink-0 border-b border-dd-border-subtle bg-dd-bg-alt/95 px-3 py-3 backdrop-blur sm:px-4 lg:px-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md">
              <span id={modelLabelId} className="px-0.5 text-xs font-medium text-dd-muted">Model</span>
              <div ref={modelMenuRef} className="relative min-w-0">
                <button
                  ref={modelTriggerRef}
                  type="button"
                  role="combobox"
                  onClick={() => (modelMenuOpen ? closeModelMenu() : openModelMenu())}
                  onKeyDown={handleModelTriggerKeyDown}
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                  aria-controls={modelMenuOpen ? modelListboxId : undefined}
                  aria-labelledby={`${modelLabelId} ${modelValueId}`}
                  className="flex min-h-11 w-full items-center gap-3 rounded-dd border border-dd-border bg-dd-surface px-3 py-2 text-left outline-none transition-colors hover:border-dd-border-subtle hover:bg-dd-surface-2 focus-visible:shadow-dd-focus"
                >
                  {activeProviderGroup ? <ProviderLogo provider={activeProviderGroup.providerId} size={28} className="shrink-0" /> : <span className="flex size-7 shrink-0 items-center justify-center rounded-dd bg-dd-surface-2 text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">smart_toy</span></span>}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5"><span id={modelValueId} className="truncate text-[13px] font-semibold text-dd-text">{modelLabel}</span><span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[18px] leading-none text-dd-muted">expand_more</span></span>
                    <span className="block truncate text-xs text-dd-muted">{modelSubLabel}</span>
                  </span>
                </button>
                {modelMenuOpen ? <Card padding={false} className="absolute start-0 top-[calc(100%+8px)] z-30 w-[min(520px,calc(100vw-1.5rem))] shadow-dd-elevated">
                  <div className="flex items-center justify-between border-b border-dd-border-subtle px-4 py-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dd-subtle">Models</p><p className="text-xs text-dd-muted">From connected providers</p></div><IconButton icon="close" label="Close model list" size="sm" onClick={closeModelMenu} /></div>
                  <div role="listbox" id={modelListboxId} tabIndex={0} onKeyDown={handleModelListKeyDown} aria-label="Available models" className="max-h-[60vh] space-y-2 overflow-y-auto p-2">
                    {providerGroups.map((group) => <div key={group.providerId} role="group" aria-label={group.providerName} className="rounded-dd border border-dd-border-subtle bg-dd-bg p-2">
                      <div className="flex items-center justify-between px-1.5 py-1.5"><div className="flex min-w-0 items-center gap-2"><ProviderLogo provider={group.providerId} size={20} /><p className="truncate text-[13px] font-semibold text-dd-text">{group.providerName}</p></div><Badge size="sm">{group.models.length}</Badge></div>
                      <div className="grid gap-1.5 sm:grid-cols-2">{group.models.map((model) => { const optIndex = modelOptions.indexOf(model); const isSelected = model.id === activeModelId; const isActiveOption = optIndex === activeModelIndex; return <button key={model.id} id={`${modelListboxId}-opt-${optIndex}`} type="button" role="option" tabIndex={-1} onClick={() => { handleSelectModel(model.id); modelTriggerRef.current?.focus(); }} onMouseEnter={() => setActiveModelIndex(optIndex)} aria-selected={isSelected} className={isActiveOption ? "rounded-dd border border-dd-accent bg-dd-accent-soft px-3 py-2.5 text-left outline-none transition-colors focus-visible:shadow-dd-focus" : isSelected ? "rounded-dd border border-dd-border bg-dd-surface-2 px-3 py-2.5 text-left outline-none transition-colors focus-visible:shadow-dd-focus" : "rounded-dd border border-transparent px-3 py-2.5 text-left outline-none transition-colors hover:border-dd-border hover:bg-dd-surface-2 focus-visible:shadow-dd-focus"}><span className="block truncate text-[13px] font-medium text-dd-text">{model.name}</span><span className="mt-0.5 block truncate text-xs text-dd-muted">{model.id}</span></button>; })}</div>
                    </div>)}
                  </div>
                </Card> : null}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {activeConnectionOptions.length > 1 ? <div className="min-w-40"><span className="mb-1 block text-xs font-medium text-dd-muted">Connection</span><Select aria-label="Connection" options={activeConnectionOptions} value={connectionValue} onChange={setActiveConnectionId} placeholder="Select connection" /></div> : null}
              {reasoningOptions && reasoningOptions.length > 1 ? <div className="min-w-36"><span className="mb-1 block text-xs font-medium text-dd-muted">Effort</span><Select aria-label="Reasoning effort" options={reasoningOptions.map((option) => ({ value: option, label: humanize(option) }))} value={reasoningEffort} onChange={setReasoningEffort} placeholder="Effort" /></div> : null}
              <span ref={historyTriggerRef}><Button variant="secondary" size="sm" icon="history" onClick={() => setHistoryOpen((value) => !value)} aria-expanded={historyOpen} aria-haspopup="dialog">History</Button></span>
<Button variant="primary" size="sm" icon="add" onClick={handleNewChat} disabled={!activeModel}>New chat</Button>
              <Button variant="ghost" size="sm" icon="delete" onClick={handleDeleteCurrentChat} disabled={!activeSessionId || sessions.length === 0}>Clear</Button>
            </div>
          </div>
        </header>
        {historyOpen ? <div ref={historyMenuRef} role="dialog" aria-label="Chat history" className="absolute end-3 top-[76px] z-30 w-[min(360px,calc(100vw-1.5rem))] overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface shadow-dd-elevated sm:end-4 lg:end-6"><div className="flex items-center justify-between border-b border-dd-border-subtle px-3 py-2"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dd-subtle">Recent chats</p><IconButton icon="close" label="Close history" size="sm" onClick={() => setHistoryOpen(false)} /></div><div role="region" tabIndex={0} aria-label="Chat history conversations" className="max-h-[48vh] space-y-1.5 overflow-y-auto p-1.5">{sessionItems.length === 0 ? <EmptyState icon="forum" title="No conversations yet" message="Start a message to create chat history." /> : paginatedSessions.items.map((session) => { const isActive = session.id === activeSessionId; const latestMessage = [...(session.messages || [])].reverse().find((message) => message.role === "user") || session.messages?.[0]; return <button key={session.id} type="button" onClick={() => handleSelectSession(session.id)} aria-pressed={isActive} className={isActive ? "w-full rounded-dd border border-dd-accent bg-dd-accent-soft px-3 py-2.5 text-left outline-none focus-visible:shadow-dd-focus" : "w-full rounded-dd border border-dd-border-subtle bg-dd-surface px-3 py-2.5 text-left outline-none transition-colors hover:bg-dd-surface-2 focus-visible:shadow-dd-focus"}><span className="flex items-start justify-between gap-3"><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-dd-text">{session.title}</span><span className="mt-0.5 block truncate text-xs text-dd-muted">{textValue(latestMessage?.content) || "Empty chat"}</span></span><span className="shrink-0 text-[10px] text-dd-subtle">{formatRelativeTime(session.updatedAt)}</span></span></button>; })}</div>{sessionItems.length > paginatedSessions.items.length ? <div className="border-t border-dd-border-subtle px-2 py-2"><Pagination page={paginatedSessions.page} pageCount={paginatedSessions.totalPages} total={sessionItems.length} rowsLabel={`${sessionItems.length} chats`} onPage={setHistoryPage} /></div> : null}</div> : null}
        {loadError ? <div role="alert" className="mx-3 mt-3 rounded-dd-lg border border-dd-danger bg-dd-danger/10 px-4 py-3 text-[13px] text-dd-danger sm:mx-4 lg:mx-6"><div className="flex items-start gap-3"><span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-[18px] leading-none text-dd-danger">error</span><p className="leading-6">{loadError}</p></div></div> : null}
        <div className="flex min-h-0 flex-1 flex-col" inert={historyOpen || modelMenuOpen ? "" : undefined}>
          <div role="region" tabIndex={0} aria-label="Conversation messages" className="flex-1 overflow-y-auto px-3 py-4 sm:px-4 lg:px-6">
            {currentMessages.length === 0 ? <EmptyState icon="forum" title="Start a conversation" message={activeModel ? `Chat with ${activeProviderGroup?.providerName || activeModel.providerName} · ${activeModel.name}` : "Chat against connected provider models after they load."} /> : null}
            <ol className="mx-auto flex w-full max-w-3xl flex-col gap-5">{currentMessages.map((message) => { const isUser = message.role === "user"; const isAssistant = message.role === "assistant"; const isStreaming = isAssistant && message.id === streamingMessageId && message.status === "streaming"; const isError = message.status === "error"; const content = textValue(message.content) || (isAssistant ? streamingText : ""); const assistantName = activeModel?.name || "Assistant"; return <li key={message.id} className={isUser ? "flex w-full justify-end gap-3" : "flex w-full justify-start gap-3"}>{!isUser ? <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-dd border border-dd-border-subtle bg-dd-surface" aria-hidden="true">{activeProviderGroup ? <ProviderLogo provider={activeProviderGroup.providerId} size={20} /> : <span className="material-symbols-outlined text-[18px] leading-none text-dd-muted">smart_toy</span>}</span> : null}<div className={isUser ? "flex min-w-0 max-w-[min(88%,42rem)] flex-col items-end" : "flex min-w-0 max-w-[min(88%,42rem)] flex-col items-start"}><div className={isUser ? "mb-1 flex flex-row-reverse items-center gap-2 px-1" : "mb-1 flex items-center gap-2 px-1"}><span className="text-xs font-semibold text-dd-text">{isUser ? "You" : assistantName}</span>{isStreaming ? <Badge tone="accent" size="sm" icon="progress_activity">Streaming</Badge> : null}{isError ? <Badge tone="danger" size="sm" icon="error">Error</Badge> : null}</div>{message.attachments?.length ? <div className={isUser ? "mb-2 grid grid-cols-2 justify-items-end gap-2 sm:grid-cols-3" : "mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3"}>{message.attachments.map((attachment) => <a key={attachment.id} href={attachment.dataUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-dd-lg border border-dd-border-subtle bg-dd-surface outline-none transition-colors hover:border-dd-accent focus-visible:shadow-dd-focus"><img src={attachment.dataUrl} alt={attachment.name} className="h-28 w-full object-cover" /></a>)}</div> : null}<div className={isUser ? "w-full whitespace-pre-wrap break-words rounded-dd-lg rounded-tr-sm bg-dd-accent-soft px-4 py-3 text-[13px] leading-6 text-dd-text" : isError ? "w-full whitespace-pre-wrap break-words rounded-dd-lg rounded-tl-sm border border-dd-danger bg-dd-danger/10 px-4 py-3 text-[13px] leading-6 text-dd-text" : "w-full whitespace-pre-wrap break-words rounded-dd-lg rounded-tl-sm border border-dd-border-subtle bg-dd-surface px-4 py-3 text-[13px] leading-6 text-dd-text"}>{content}{isAssistant && isStreaming && !streamingText ? <span aria-label="Streaming response" className="ms-1 inline-block size-2 animate-pulse rounded-full bg-dd-accent" /> : null}</div></div></li>; })}</ol>
          </div>
          <div className="shrink-0 border-t border-dd-border-subtle bg-dd-bg-alt/95 px-3 py-3 backdrop-blur sm:px-4 lg:px-6">
            {attachments.length > 0 ? <div className="mx-auto mb-2.5 flex w-full max-w-3xl flex-wrap gap-2">{attachments.map((attachment) => <div key={attachment.id} className="flex items-center gap-2 rounded-full border border-dd-border-subtle bg-dd-surface py-1 ps-2 pe-1"><img src={attachment.dataUrl} alt={attachment.name} className="size-7 rounded-full object-cover" /><span className="max-w-40 truncate text-xs text-dd-text">{attachment.name}</span><IconButton icon="close" label={`Remove ${attachment.name}`} size="sm" onClick={() => removeAttachment(attachment.id)} /></div>)}</div> : null}
            <div className="mx-auto w-full max-w-3xl rounded-dd-lg border border-dd-border bg-dd-surface p-2 transition-colors focus-within:border-dd-accent focus-within:shadow-dd-focus"><Textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder={`Message ${activeModel?.name || "model"}`} rows={1} aria-label="Message input" className="max-h-[25vh] min-h-11 resize-none border-0 bg-transparent px-2 py-2 text-[13px] leading-6 shadow-none hover:border-0 focus:border-0 focus:shadow-none" /><div className="flex items-center justify-between gap-3 pt-1"><div className="flex min-w-0 items-center gap-1"><IconButton icon="attach_file" label="Attach image" disabled={!activeModel || loadingData} onClick={() => fileInputRef.current?.click()} /><input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAttachFiles} /><span className="truncate ps-1 text-xs font-medium text-dd-subtle">{activeModel ? activeModel.name : "No model"}</span></div><div className="flex shrink-0 items-center gap-2">{isSending ? <Button variant="secondary" size="sm" icon="stop" onClick={handleStop}>Stop</Button> : null}<Button variant="primary" size="sm" icon="arrow_upward" onClick={sendMessage} disabled={!canSend} aria-label="Send message" className="min-w-11">Send</Button></div></div></div>
            <p className="mt-2 px-1 text-center text-[11px] text-dd-subtle">Enter to send · Shift+Enter for newline · Model list is filtered from connected providers.</p>
          </div>
        </div>
      </section>
    </main>
  );
}