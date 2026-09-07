"use client";

import { useEffect, useMemo, useState } from "react";

const ALL_PAGES = 1;

function isAllPageSize(pageSize) {
  return pageSize === "all";
}

function safePageSize(pageSize) {
  return isAllPageSize(pageSize) ? "all" : Math.max(1, Math.floor(Number(pageSize)) || 1);
}

/**
 * Minimal client-side pagination hook.
 *
 * @param {object} options
 * @param {Array} options.items - Full collection to paginate (already filtered/sorted)
 * @param {number|"all"} [options.pageSize=20] - Rows per page; "all" returns every item on page 1.
 * @param {string|number} [options.resetKey] - When this changes, page resets to 1
 * @returns {{
 *   page: number,
 *   pageSize: number|"all",
 *   setPage: (page: number) => void,
 *   setPageSize: (size: number|"all") => void,
 *   pageItems: Array,
 *   totalItems: number,
 *   totalPages: number,
 * }}
 */
export function usePagination({ items = [], pageSize = 20, resetKey = null } = {}) {
  const initialSize = safePageSize(pageSize);
  const [page, setPage] = useState(1);
  const [currentPageSize, setCurrentPageSize] = useState(initialSize);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const totalItems = items.length;
  const totalPages = isAllPageSize(currentPageSize) ? ALL_PAGES : Math.max(1, Math.ceil(totalItems / currentPageSize));

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const safePage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    if (isAllPageSize(currentPageSize)) return items.slice();
    const start = (safePage - 1) * currentPageSize;
    return items.slice(start, start + currentPageSize);
  }, [items, safePage, currentPageSize]);

  const setPageSafe = (next) => {
    setPage((p) => Math.min(Math.max(1, next), totalPages || 1));
  };

  const setPageSize = (size) => {
    const next = safePageSize(size);
    setCurrentPageSize(next);
    setPage(1);
  };

  return {
    page: safePage,
    pageSize: currentPageSize,
    setPage: setPageSafe,
    setPageSize,
    pageItems,
    totalItems,
    totalPages,
  };
}

/**
 * Helper: compute a safe slice for a given page without state. `pageSize="all"`
 * returns every item on page 1.
 */
export function paginate(items, page, pageSize) {
  const safePage = Math.max(1, Math.floor(Number(page)) || 1);
  if (isAllPageSize(pageSize)) return safePage === 1 ? items.slice() : [];
  const safePageSize = Math.max(1, Math.floor(Number(pageSize)) || 1);
  const start = (safePage - 1) * safePageSize;
  return items.slice(start, start + safePageSize);
}
export function clampPage(page, totalPages) {
  return Math.min(Math.max(1, page), Math.max(1, totalPages));
}
