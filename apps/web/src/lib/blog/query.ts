import type {
	MarbleAuthorList,
	MarbleCategoryList,
	MarblePost,
	MarblePostList,
	MarbleTagList,
} from "@/types/blog";
import { unified } from "unified";
import rehypeParse from "rehype-parse";
import rehypeStringify from "rehype-stringify";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSanitize from "rehype-sanitize";

const marbleApiUrl = process.env.NEXT_PUBLIC_MARBLE_API_URL?.trim();
const marbleWorkspaceKey = process.env.MARBLE_WORKSPACE_KEY?.trim();

const EMPTY_PAGINATION: MarblePostList["pagination"] = {
	limit: 0,
	currpage: 1,
	nextPage: null,
	prevPage: null,
	totalItems: 0,
	totalPages: 0,
};

const EMPTY_POST_LIST: MarblePostList = {
	posts: [],
	pagination: EMPTY_PAGINATION,
};

const EMPTY_TAG_LIST: MarbleTagList = {
	tags: [],
	pagination: EMPTY_PAGINATION,
};

const EMPTY_CATEGORY_LIST: MarbleCategoryList = {
	categories: [],
	pagination: EMPTY_PAGINATION,
};

const EMPTY_AUTHOR_LIST: MarbleAuthorList = {
	authors: [],
	pagination: EMPTY_PAGINATION,
};

function isPlaceholderValue(value?: string): boolean {
	if (!value) return true;

	const normalizedValue = value.trim().toLowerCase();

	return (
		normalizedValue === "" ||
		normalizedValue === "placeholder" ||
		normalizedValue === "build-placeholder" ||
		normalizedValue.includes("placeholder.example.com")
	);
}

function isMarbleConfigured(): boolean {
	return !(
		isPlaceholderValue(marbleApiUrl) ||
		isPlaceholderValue(marbleWorkspaceKey)
	);
}

async function fetchFromMarble<T>({
	endpoint,
}: {
	endpoint: string;
}): Promise<T | null> {
	if (!isMarbleConfigured()) {
		return null;
	}

	try {
		const response = await fetch(
			`${marbleApiUrl}/${marbleWorkspaceKey}/${endpoint}`,
		);

		if (response.status === 404) {
			return null;
		}

		if (!response.ok) {
			throw new Error(
				`Failed to fetch ${endpoint}: ${response.status} ${response.statusText}`,
			);
		}

		return (await response.json()) as T;
	} catch (error) {
		console.warn(`Error fetching ${endpoint} from Marble CMS:`, error);
		return null;
	}
}

export async function getPosts() {
	return (
		(await fetchFromMarble<MarblePostList>({ endpoint: "posts" })) ??
		EMPTY_POST_LIST
	);
}

export async function getTags() {
	return (
		(await fetchFromMarble<MarbleTagList>({ endpoint: "tags" })) ??
		EMPTY_TAG_LIST
	);
}

export async function getSinglePost({
	slug,
}: {
	slug: string;
}): Promise<MarblePost | null> {
	return fetchFromMarble<MarblePost>({ endpoint: `posts/${slug}` });
}

export async function getCategories() {
	return (
		(await fetchFromMarble<MarbleCategoryList>({ endpoint: "categories" })) ??
		EMPTY_CATEGORY_LIST
	);
}

export async function getAuthors() {
	return (
		(await fetchFromMarble<MarbleAuthorList>({ endpoint: "authors" })) ??
		EMPTY_AUTHOR_LIST
	);
}

export async function processHtmlContent({
	html,
}: {
	html: string;
}): Promise<string> {
	const processor = unified()
		.use(rehypeSanitize)
		.use(rehypeParse, { fragment: true })
		.use(rehypeSlug)
		.use(rehypeAutolinkHeadings, { behavior: "append" })
		.use(rehypeStringify);

	const file = await processor.process({ value: html, type: "html" });
	return String(file);
}
