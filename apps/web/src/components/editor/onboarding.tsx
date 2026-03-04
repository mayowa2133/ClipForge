"use client";

import { ArrowRightIcon, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { useEditor } from "@/hooks/use-editor";
import { SOCIAL_LINKS } from "@/constants/site-constants";
import { useLocalStorage } from "@/hooks/storage/use-local-storage";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "../ui/dialog";
import { ENABLE_CLIPFORGE_EXPERIENCE } from "@/constants/feature-flags";
import {
	CLIPFORGE_DEMO_MANIFEST,
	DemoProjectCreationError,
} from "@/lib/clipforge";
import { useClipForgeOnboardingStore } from "@/stores/clipforge-onboarding-store";
import { useChatPanelStore } from "@/stores/chat-panel-store";

const DEMO_LOADING_STEPS = [
	"Preparing demo project",
	"Importing demo clips",
	"Building timeline",
	"Generating captions",
] as const;

export function Onboarding() {
	if (!ENABLE_CLIPFORGE_EXPERIENCE) {
		return <LegacyOnboarding />;
	}

	return <ClipForgeOnboarding />;
}

function ClipForgeOnboarding() {
	const editor = useEditor();
	const router = useRouter();
	const openChatPanel = useChatPanelStore((state) => state.open);
	const {
		hasSeenIntro,
		hasCompletedDemoGuide,
		pendingGuide,
		markIntroSeen,
		markDemoGuideCompleted,
		startPendingGuide,
		clearPendingGuide,
	} = useClipForgeOnboardingStore();
	const [isLoadingDemo, setIsLoadingDemo] = useState(false);
	const [loadingStepIndex, setLoadingStepIndex] = useState(0);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const activeProject = editor.project.getActiveOrNull();
	const mediaCount = editor.media.getAssets().filter((asset) => !asset.ephemeral).length;
	const isEmptyProject = Boolean(activeProject) && mediaCount === 0;
	const showIntro = isEmptyProject && !hasSeenIntro && !pendingGuide && !isLoadingDemo;
	const showGuide = pendingGuide && !hasCompletedDemoGuide;
	const isOpen = showIntro || isLoadingDemo || showGuide;

	useEffect(() => {
		if (!isLoadingDemo) {
			setLoadingStepIndex(0);
			return;
		}

		const interval = window.setInterval(() => {
			setLoadingStepIndex((current) =>
				Math.min(current + 1, DEMO_LOADING_STEPS.length - 1),
			);
		}, 700);

		return () => window.clearInterval(interval);
	}, [isLoadingDemo]);

	const handleDialogOpenChange = (open: boolean) => {
		if (open || isLoadingDemo) return;

		if (showGuide) {
			markDemoGuideCompleted();
			clearPendingGuide();
			return;
		}

		if (showIntro) {
			markIntroSeen();
		}
	};

	const handleStartEmpty = () => {
		setErrorMessage(null);
		markIntroSeen();
	};

	const handleTryDemoProject = async () => {
		if (isLoadingDemo) return;

		setErrorMessage(null);
		setIsLoadingDemo(true);
		try {
			const result = await editor.clipforge.createDemoProject();
			startPendingGuide();
			router.replace(`/editor/${result.projectId}`);
		} catch (error) {
			const maybeDemoError =
				error instanceof DemoProjectCreationError ? error : null;
			if (maybeDemoError?.projectId) {
				router.replace(`/editor/${maybeDemoError.projectId}`);
			}
			setErrorMessage(
				error instanceof Error ? error.message : "Failed to create demo project.",
			);
		} finally {
			setIsLoadingDemo(false);
		}
	};

	const handleOpenChat = () => {
		openChatPanel();
	};

	const handleUseSamplePrompt = () => {
		openChatPanel();
		editor.clipforge.populateChatDraft(CLIPFORGE_DEMO_MANIFEST.samplePrompts[0] ?? "");
	};

	if (!isOpen) {
		return null;
	}

	return (
		<Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
			<DialogContent className="sm:max-w-[520px]">
				<DialogTitle>
					<span className="sr-only">ClipForge onboarding</span>
				</DialogTitle>
				<DialogDescription className="sr-only">
					ClipForge onboarding and guided demo setup.
				</DialogDescription>
				<DialogBody>
					{isLoadingDemo ? (
						<div className="space-y-5">
							<div className="space-y-3">
								<Title title="Setting up your demo project" />
								<p className="text-muted-foreground text-sm">
									{DEMO_LOADING_STEPS[loadingStepIndex]}
								</p>
							</div>
							<div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
								<Loader2 className="size-4 animate-spin" />
								<span>Preparing the real ClipForge workflow...</span>
							</div>
						</div>
					) : showGuide ? (
						<div className="space-y-5">
							<div className="space-y-3">
								<Title title="Your demo is ready" />
								<p className="text-muted-foreground text-sm">
									Follow the real workflow below. Nothing here is mocked.
								</p>
							</div>
							<ol className="space-y-2 text-sm">
								<li>1. Press play to preview the cut</li>
								<li>2. Open Chat and try a sample edit</li>
								<li>3. Apply the suggested JSON ops</li>
								<li>4. Use the top-right Export button</li>
							</ol>
							<div className="flex flex-col gap-2 sm:flex-row">
								<Button onClick={handleOpenChat} variant="outline" className="flex-1">
									Open Chat
								</Button>
								<Button onClick={handleUseSamplePrompt} variant="outline" className="flex-1">
									Use Sample Prompt
								</Button>
							</div>
							<Button
								onClick={() => {
									markDemoGuideCompleted();
									clearPendingGuide();
								}}
								className="w-full"
							>
								Done
							</Button>
						</div>
					) : (
						<div className="space-y-5">
							<div className="space-y-3">
								<Title title="Edit a vertical video in 60 seconds" />
								<p className="text-muted-foreground text-sm">
									ClipForge can auto-cut clips, generate captions, and apply edits from chat.
								</p>
							</div>
							<div className="grid gap-2 text-sm">
								<p>1. Import clips</p>
								<p>2. Auto-edit a vertical draft</p>
								<p>3. Generate captions</p>
								<p>4. Refine the cut in Chat</p>
								<p>5. Export from the top-right button</p>
							</div>
							{errorMessage ? (
								<div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
									{errorMessage}
								</div>
							) : null}
							<div className="flex flex-col gap-2 sm:flex-row">
								<Button onClick={() => void handleTryDemoProject()} className="flex-1">
									{errorMessage ? "Try Again" : "Try Demo Project"}
									<ArrowRightIcon className="size-4" />
								</Button>
								<Button onClick={handleStartEmpty} variant="outline" className="flex-1">
									Start Empty
								</Button>
							</div>
							<Button onClick={handleStartEmpty} variant="ghost" className="w-full">
								Not now
							</Button>
						</div>
					)}
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}

function LegacyOnboarding() {
	const [step, setStep] = useState(0);
	const [hasSeenOnboarding, setHasSeenOnboarding] = useLocalStorage({
		key: "hasSeenOnboarding",
		defaultValue: false,
	});

	const isOpen = !hasSeenOnboarding;

	const handleNext = () => {
		setStep(step + 1);
	};

	const handleClose = () => {
		setHasSeenOnboarding({ value: true });
	};

	const getStepTitle = () => {
		switch (step) {
			case 0:
				return "Welcome to OpenCut Beta! 🎉";
			case 1:
				return "⚠️ This is a super early beta!";
			case 2:
				return "🦋 Have fun testing!";
			default:
				return "OpenCut Onboarding";
		}
	};

	const renderStepContent = () => {
		switch (step) {
			case 0:
				return (
					<div className="space-y-5">
						<div className="space-y-3">
							<Title title="Welcome to OpenCut Beta! 🎉" />
							<Description description="You're among the first to try OpenCut - the fully open source CapCut alternative." />
						</div>
						<NextButton onClick={handleNext}>Next</NextButton>
					</div>
				);
			case 1:
				return (
					<div className="space-y-5">
						<div className="space-y-3">
							<Title title={getStepTitle()} />
							<Description description="There's still a ton of things to do to make this editor amazing." />
							<Description description="A lot of features are still missing. We're working hard to build them out!" />
							<Description description="If you're curious, check out our roadmap [here](https://opencut.app/roadmap)" />
						</div>
						<NextButton onClick={handleNext}>Next</NextButton>
					</div>
				);
			case 2:
				return (
					<div className="space-y-5">
						<div className="space-y-3">
							<Title title={getStepTitle()} />
							<Description
								description={`Join our [Discord](${SOCIAL_LINKS.discord}), chat with cool people and share feedback to help make OpenCut the best editor ever.`}
							/>
						</div>
						<NextButton onClick={handleClose}>Finish</NextButton>
					</div>
				);
			default:
				return null;
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogTitle>
					<span className="sr-only">{getStepTitle()}</span>
				</DialogTitle>
				<DialogDescription className="sr-only">
					OpenCut onboarding dialog.
				</DialogDescription>
				<DialogBody>{renderStepContent()}</DialogBody>
			</DialogContent>
		</Dialog>
	);
}

function Title({ title }: { title: string }) {
	return <h2 className="text-lg font-bold md:text-xl">{title}</h2>;
}

function Description({ description }: { description: string }) {
	return (
		<div className="text-muted-foreground">
			<ReactMarkdown
				components={{
					p: ({ children }) => <p className="mb-0">{children}</p>,
					a: ({ href, children }) => (
						<a
							href={href}
							target="_blank"
							rel="noopener noreferrer"
							className="text-foreground hover:text-foreground/80 underline"
						>
							{children}
						</a>
					),
				}}
			>
				{description}
			</ReactMarkdown>
		</div>
	);
}

function NextButton({
	children,
	onClick,
}: {
	children: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<Button onClick={onClick} variant="default" className="w-full">
			{children}
			<ArrowRightIcon className="size-4" />
		</Button>
	);
}
