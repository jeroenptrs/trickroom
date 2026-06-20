export type SystemComponentSummary = {
	componentId: string;
	slug: string;
	name: string;
	description?: string;
	group?: string;
	order?: number;
	hasDraft: boolean;
	hasPublished: boolean;
	currentVersion?: string;
	createdAt: string;
	updatedAt: string;
};
