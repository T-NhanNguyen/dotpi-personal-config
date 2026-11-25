import { vaultSetup, vaultLayout, vaultIndexAndHandoff, vaultEvidenceAndNotes, vaultMaintenance } from "../sections/dev-journaling.ts";

export default {
	id: "dev-journaling.md",
	name: "Dev Journaling",
	description: "Establish and maintain a private development journal (Obsidian vault) inside a repo. TOC upkeep every session, markdown-only notes, and gitignore integration so the vault is never committed.",
	placement: "append",
	order: 6,
	sections: [vaultSetup, vaultLayout, vaultIndexAndHandoff, vaultEvidenceAndNotes, vaultMaintenance],
} as const;
