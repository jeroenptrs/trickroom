import { createBrowserRouter, RouterProvider } from "react-router";
import { Design } from "./components/Design";
import { Root } from "./components/Root";

const router = createBrowserRouter([
	{
		path: "/",
		Component: Root,
		children: [
			{
				path: "design/:uuid",
				Component: Design,
			},
		],
	},
	// {
	// 	path: "*",
	// 	Component: Root,
	// },
]);

export default function App() {
	return <RouterProvider router={router} />;
}
