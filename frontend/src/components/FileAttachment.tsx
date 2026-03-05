import {
	Archive,
	Code,
	File,
	FileText,
	Image as ImageIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

export interface FileAttachmentProps {
	filename: string;
	path: string;
	size?: number;
	downloadUrl: string;
}

export function FileAttachment({
	filename,
	size,
	downloadUrl,
}: FileAttachmentProps) {
	const [imageError, setImageError] = useState(false);

	// Determine icon based on file type
	const getFileIcon = () => {
		const ext = filename.split(".").pop()?.toLowerCase();

		if (
			["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext || "")
		) {
			return <ImageIcon className="h-5 w-5" />;
		}
		if (["pdf", "txt", "md", "csv"].includes(ext || "")) {
			return <FileText className="h-5 w-5" />;
		}
		if (["zip", "tar", "gz", "7z"].includes(ext || "")) {
			return <Archive className="h-5 w-5" />;
		}
		if (["js", "ts", "py", "rs", "go", "html", "css"].includes(ext || "")) {
			return <Code className="h-5 w-5" />;
		}
		return <File className="h-5 w-5" />;
	};

	// Format file size
	const formatSize = (bytes?: number): string => {
		if (!bytes) return "";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	};

	// Check if file is an image
	const ext = filename.split(".").pop()?.toLowerCase() || "";
	const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(
		ext,
	);

	// Render images inline
	if (isImage) {
		if (imageError) {
			return (
				<Card className="flex items-center gap-3 px-3 py-2 mt-2 bg-muted/50">
					<div className="text-muted-foreground shrink-0">{getFileIcon()}</div>
					<div className="flex-1 min-w-0">
						<p className="text-sm font-medium truncate">{filename}</p>
						<p className="text-xs text-destructive">Failed to load image</p>
					</div>
					<Button variant="ghost" size="sm" asChild className="shrink-0">
						<a href={downloadUrl} download={filename}>
							Download
						</a>
					</Button>
				</Card>
			);
		}

		return (
			<div className="mt-2">
				<a
					href={downloadUrl}
					download={filename}
					target="_blank"
					rel="noopener noreferrer"
					className="block"
				>
					<img
						src={downloadUrl}
						alt={filename}
						className="max-w-full max-h-96 object-contain rounded border border-muted hover:opacity-90 transition-opacity cursor-pointer"
						loading="lazy"
						onError={() => setImageError(true)}
					/>
				</a>
				{size && (
					<p className="text-xs text-muted-foreground mt-1">
						{formatSize(size)}
					</p>
				)}
			</div>
		);
	}

	// Render other files as download links
	return (
		<Card className="flex items-center gap-3 px-3 py-2 mt-2 bg-muted/50 hover:bg-muted/70 transition-colors">
			<div className="text-muted-foreground shrink-0">{getFileIcon()}</div>
			<div className="flex-1 min-w-0">
				<p className="text-sm font-medium truncate">{filename}</p>
				{size && (
					<p className="text-xs text-muted-foreground">{formatSize(size)}</p>
				)}
			</div>
			<Button variant="ghost" size="sm" asChild className="shrink-0">
				<a href={downloadUrl} download={filename}>
					Download
					<span className="sr-only">Download {filename}</span>
				</a>
			</Button>
		</Card>
	);
}
