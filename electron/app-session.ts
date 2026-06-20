import { session } from "electron";

const appSessionPartition = "trickroom-app";

export const getAppSession = () => session.fromPartition(appSessionPartition);
