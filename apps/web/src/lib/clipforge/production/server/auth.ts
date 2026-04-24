import { auth } from "@/lib/auth/server";

export class ClipForgeAuthError extends Error {
	status = 401;
}

export async function requireClipForgeUser(request: Request): Promise<{
	id: string;
	email?: string | null;
	name?: string | null;
}> {
	const session = await auth.api.getSession({
		headers: request.headers,
	});

	if (!session?.user?.id) {
		const error = new ClipForgeAuthError("Sign in to use ClipForge cloud features.");
		throw error;
	}

	return session.user;
}
