import { useState } from "react";
import { api, type KnownVault, type VaultInfo } from "../api";

/**
 * Vault switcher at the top of the sidebar: a dropdown of loaded vaults, a
 * one-click list of projects discovered from the pi sessions dir, and a raw
 * path input for anything else. Adding a vault reloads every panel via
 * onChanged; failures surface in the shared error banner.
 */
export function VaultPanel({
	vaults,
	active,
	known,
	onSelect,
	onChanged,
}: {
	vaults: VaultInfo[];
	/** Currently selected vault path, or null for the server default. */
	active: string | null;
	known: KnownVault[];
	onSelect: (vault: string | null) => void;
	onChanged: () => void;
}) {
	const [path, setPath] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const add = async (target: string) => {
		setBusy(true);
		setError(null);
		try {
			await api.addVault(target);
			setPath("");
			onChanged();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="vault-panel">
			<h2>Vault</h2>
			<select
				className="vault-select"
				value={active ?? ""}
				title={active ?? "default vault"}
				onChange={(event) => onSelect(event.target.value === "" ? null : event.target.value)}
			>
				{vaults.map((vault) => (
					<option key={vault.path} value={vault.path} title={vault.path}>
						{vault.name}
						{vault.default ? " (default)" : ""} · {vault.traceCount} traces
					</option>
				))}
			</select>
			<div className="vault-add">
				<input
					type="text"
					value={path}
					placeholder="/abs/path/to/project"
					onChange={(event) => setPath(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && path.trim()) void add(path.trim());
					}}
				/>
				<button className="add-vault" disabled={busy || path.trim().length === 0} onClick={() => void add(path.trim())}>
					Add
				</button>
			</div>
			{known.length > 0 ? (
				<details className="known">
					<summary>Known projects</summary>
					<ul className="known-vaults">
						{known.map((entry) => (
							<li key={entry.path} className="known-vault" title={entry.path}>
								<span className="known-vault-name">{entry.name}</span>
								{entry.loaded ? (
									<span className="known-vault-state">loaded</span>
								) : (
									<button className="add-vault" disabled={busy} onClick={() => void add(entry.path)}>
										add
									</button>
								)}
							</li>
						))}
					</ul>
				</details>
			) : null}
			{error ? <div className="error-banner">{error}</div> : null}
		</section>
	);
}
