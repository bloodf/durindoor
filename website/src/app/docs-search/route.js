import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@site/lib/source";

export const { GET } = createFromSource(source);
