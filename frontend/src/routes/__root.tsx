import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
	component: () => (
		<>
			<div className="bg-background min-h-screen">
				<Outlet />
			</div>
		</>
	),
});
