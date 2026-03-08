import { SetElementAdjustmentsCommand } from "./set-element-adjustments";

export class ResetElementAdjustmentsCommand extends SetElementAdjustmentsCommand {
	constructor(trackId: string, elementId: string) {
		super(trackId, elementId, null);
	}
}
