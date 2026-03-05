import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ConfigInputProps {
	label: string;
	description?: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	isSecret?: boolean;
	required?: boolean;
	error?: string;
	disabled?: boolean;
}

export function ConfigInput({
	label,
	description,
	value,
	onChange,
	placeholder,
	isSecret = false,
	required = false,
	error,
	disabled = false,
}: ConfigInputProps) {
	const [showSecret, setShowSecret] = useState(false);

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<label className="text-sm font-medium">
					{label}
					{required && <span className="text-destructive ml-1">*</span>}
				</label>
				{isSecret && value && (
					<button
						type="button"
						onClick={() => setShowSecret(!showSecret)}
						className="text-muted-foreground hover:text-foreground transition-colors"
						tabIndex={-1}
					>
						{showSecret ? (
							<EyeOff className="h-4 w-4" />
						) : (
							<Eye className="h-4 w-4" />
						)}
					</button>
				)}
			</div>
			<div className="relative">
				<input
					type={isSecret && !showSecret ? "password" : "text"}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					disabled={disabled}
					className={cn(
						"flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs",
						"transition-colors",
						"outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
						"disabled:cursor-not-allowed disabled:opacity-50",
						"placeholder:text-muted-foreground",
						error
							? "border-destructive focus-visible:ring-destructive/20"
							: "border-input focus-visible:border-ring",
					)}
				/>
			</div>
			{description && !error && (
				<p className="text-xs text-muted-foreground">{description}</p>
			)}
			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	);
}
