import { Composition } from "remotion";
import { DemoVideo } from "./video";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="VornVoiceDemo"
        component={DemoVideo}
        durationInFrames={240}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
