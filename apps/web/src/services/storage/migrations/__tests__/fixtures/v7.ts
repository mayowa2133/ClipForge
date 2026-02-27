export const v7Project = {
	id: "project-v7-123",
	version: 7,
	metadata: {
		id: "project-v7-123",
		name: "My V7 Project",
		thumbnail: "data:image/png;base64,abc123",
		duration: 12,
		createdAt: "2025-01-01T10:00:00.000Z",
		updatedAt: "2025-01-01T12:00:00.000Z",
	},
	settings: {
		fps: 30,
		canvasSize: { width: 1920, height: 1080 },
		background: { type: "color", color: "#000000" },
	},
	currentSceneId: "scene-main",
	scenes: [
		{
			id: "scene-main",
			name: "Main scene",
			isMain: true,
			tracks: [
				{
					id: "track-1",
					type: "video",
					name: "Video Track",
					isMain: true,
					muted: false,
					hidden: false,
					elements: [],
				},
			],
			bookmarks: [],
			createdAt: "2025-01-01T10:00:00.000Z",
			updatedAt: "2025-01-01T12:00:00.000Z",
		},
	],
};
