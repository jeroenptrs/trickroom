import { useProjectConfig } from "./contexts";
import { Designs } from "./project/Designs";
import { Systems } from "./project/Systems";
import { Separator } from "./ui/separator";
import { Text } from "./ui/text";

export function Project() {
	const { name } = useProjectConfig();

	return (
		<div className="flex flex-col gap-4 p-4 mx-auto 2xl:max-w-312">
			<div className="flex flex-row items-center justify-between">
				<Text variant="title">{name}</Text>
			</div>
			<Separator />
			<Designs />
			<Systems />
		</div>
	);
}
