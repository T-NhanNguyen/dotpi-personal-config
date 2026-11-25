import { updateDotpiWorkflow } from "../sections/make-update-to-dotpi.ts";

export default {
	id: "make-update-to-dotpi.md",
	name: "Update to dotpi",
	description: "When reqested to make corrections and updates to anything in the custom extension",
	placement: "append",
	order: 12,
	sections: [updateDotpiWorkflow],
} as const;
