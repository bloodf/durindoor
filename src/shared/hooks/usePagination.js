"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Minimal client-side pagination hook.
 *
 * @param {object} options
 * @param {Array} options.items - Full collection to paginate (already filtered/sorted)
 * @param {number} [options.pageSize=20] - Rows per page
 * @param {string|number} [options.resetKey] - When this changes, page resets to 1
 * @returns {{
 *   page: number,
 *   pageSize: number,
 *   setPage: (page: number) => void,
 *   setPageSize: (size: number) => void,
 *   pageItems: Array,
 *   totalItems: number,
 *   totalPages: number,
 * }}
 */
export function usePagination({ items = [], pageSize = 20, resetKey = null }) {
  const [page, setPage] = useState(1);
  const [currentPageSize, setCurrentPageSize] = useState(pageSize);

  // Reset to first page when an explicit filter/sort key changes.
  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / currentPageSize));

  // Clamp current page to available pages whenever totals change.
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const safePage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * currentPageSize;
    return items.slice(start, start + currentPageSize);
  }, [items, safePage, currentPageSize]);

  const setPageSafe = (next) => {
    setPage((p) => Math.min(Math.max(1, next), totalPages || 1));
  };

  const setPageSize = (size) => {
    const next = Math.max(1, size);
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
 * Helper: compute a safe slice for a given page without state.
 *
 * @param {Array} items
 * @param {number} page - 1-based page
 * @param {number} pageSize
 * @returns {Array}
 */
export function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/**
 * Helper: clamp a 1-based page to total pages.
 *
 * @param {number} page
 * @param {number} totalPages
 * @returns {number}
 */
export function clampPage(page, totalPages) {
  return Math.min(Math.max(1, page), Math.max(1, totalPages));
}
