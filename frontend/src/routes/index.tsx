import { createFileRoute } from "@tanstack/react-router";
import { ChatContainer } from "../components/ChatContainer";

export const Route = createFileRoute("/")({
	component: ChatContainer,
});
