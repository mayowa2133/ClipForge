import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface PexelsVideoFile {
	id: number;
	quality: string;
	file_type: string;
	width: number;
	height: number;
	link: string;
}

interface PexelsVideo {
	id: number;
	width: number;
	height: number;
	duration: number;
	image: string;
	video_files: PexelsVideoFile[];
	user: { name: string; url: string };
}

interface PexelsSearchResponse {
	page: number;
	per_page: number;
	total_results: number;
	videos: PexelsVideo[];
}

export interface StockVideoResult {
	id: number;
	thumbnailUrl: string;
	previewUrl: string;
	downloadUrl: string;
	duration: number;
	width: number;
	height: number;
	aspectRatio: string;
	author: string;
	license: "pexels";
}

function computeAspectRatio(w: number, h: number): string {
	const r = w / h;
	if (Math.abs(r - 16 / 9) < 0.1) return "16:9";
	if (Math.abs(r - 9 / 16) < 0.1) return "9:16";
	if (Math.abs(r - 1) < 0.1) return "1:1";
	if (Math.abs(r - 4 / 3) < 0.1) return "4:3";
	return `${w}:${h}`;
}

function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
	const mp4s = files
		.filter((f) => f.file_type === "video/mp4")
		.sort((a, b) => b.width - a.width);
	return mp4s[0] ?? null;
}

export async function GET(request: Request) {
	const apiKey = process.env.PEXELS_API_KEY;
	if (!apiKey) {
		return NextResponse.json(
			{ error: "Pexels API key not configured. Set PEXELS_API_KEY." },
			{ status: 503 },
		);
	}

	const url = new URL(request.url);
	const q = url.searchParams.get("q");
	if (!q || q.trim().length === 0) {
		return NextResponse.json(
			{ error: "Search query 'q' is required." },
			{ status: 400 },
		);
	}

	const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
	const perPage = Math.min(
		80,
		Math.max(1, Number(url.searchParams.get("per_page") ?? "15") || 15),
	);
	const orientation = url.searchParams.get("orientation") ?? "";
	const size = url.searchParams.get("size") ?? "";

	const searchUrl = new URL("https://api.pexels.com/videos/search");
	searchUrl.searchParams.set("query", q.trim());
	searchUrl.searchParams.set("page", String(page));
	searchUrl.searchParams.set("per_page", String(perPage));
	if (orientation) searchUrl.searchParams.set("orientation", orientation);
	if (size) searchUrl.searchParams.set("size", size);

	const response = await fetch(searchUrl.toString(), {
		headers: { Authorization: apiKey },
	});

	if (!response.ok) {
		return NextResponse.json(
			{ error: `Pexels API returned status ${response.status}.` },
			{ status: 502 },
		);
	}

	const data = (await response.json()) as unknown as PexelsSearchResponse;

	const results: StockVideoResult[] = data.videos
		.map((video) => {
			const best = pickBestFile(video.video_files);
			if (!best) return null;
			return {
				id: video.id,
				thumbnailUrl: video.image,
				previewUrl: best.link,
				downloadUrl: best.link,
				duration: video.duration,
				width: video.width,
				height: video.height,
				aspectRatio: computeAspectRatio(video.width, video.height),
				author: video.user.name,
				license: "pexels" as const,
			};
		})
		.filter((r): r is StockVideoResult => r !== null);

	return NextResponse.json({
		results,
		total: data.total_results,
		page: data.page,
		perPage: data.per_page,
	});
}
