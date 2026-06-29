export interface LinkedAbortOptions {
	abortSignal?: AbortSignal;
	timeoutMs?: number;
	abortReason?: string;
	timeoutReason?: string;
}

export interface LinkedAbortHandle {
	controller: AbortController;
	cleanup: () => void;
	wasExternallyAborted: () => boolean;
	timedOut: () => boolean;
}

export function createLinkedAbortController(
	options: LinkedAbortOptions = {},
): LinkedAbortHandle {
	const controller = new AbortController();
	let externalAborted = false;
	let didTimeout = false;

	const abortWithExternalReason = (): void => {
		externalAborted = true;
		controller.abort(
			options.abortSignal?.reason ??
				new Error(options.abortReason || "Operation aborted"),
		);
	};

	if (options.abortSignal) {
		if (options.abortSignal.aborted) {
			abortWithExternalReason();
		} else {
			options.abortSignal.addEventListener("abort", abortWithExternalReason, {
				once: true,
			});
		}
	}

	const timeoutId =
		typeof options.timeoutMs === "number"
			? setTimeout(() => {
					didTimeout = true;
					controller.abort(
						new Error(options.timeoutReason || "Operation timed out"),
					);
				}, options.timeoutMs)
			: null;

	return {
		controller,
		cleanup: () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			if (options.abortSignal) {
				options.abortSignal.removeEventListener(
					"abort",
					abortWithExternalReason,
				);
			}
		},
		wasExternallyAborted: () => externalAborted,
		timedOut: () => didTimeout,
	};
}
