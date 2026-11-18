/** The goal's picture, or a placeholder with "Add picture" when it's missing on this Mac. */
import { useId, useRef, useState } from "react";
import { Icon } from "../../ui/Icon.tsx";
import { removeGoalPicture, saveGoalPicture, useGoalPicture } from "./pictures.ts";

export interface GoalPictureProps {
  goalId: string;
  name: string;
  color: string;
  size?: number;
  /** Show the add/change control. */
  editable?: boolean;
}

export function GoalPicture({ goalId, name, color, size = 112, editable = true }: GoalPictureProps) {
  const pic = useGoalPicture(goalId);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose an image file.");
    if (file.size > 15 * 1024 * 1024) return setError("That image is over 15 MB.");
    setError(null);
    try {
      await saveGoalPicture(goalId, file);
    } catch {
      setError("Couldn't save the picture on this Mac.");
    }
  };

  return (
    <div className="gl-picture" style={{ width: size, height: size, ["--_goal" as string]: color }}>
      {pic.status === "ready" ? (
        <img src={pic.url} alt={name} className="gl-picture__img" />
      ) : (
        <div className="gl-picture__placeholder" role="img" aria-label={pic.status === "missing" ? `No picture of ${name} on this Mac` : `Loading picture of ${name}`} data-testid="goal-picture-placeholder">
          <Icon name="goals" size={Math.round(size / 3)} />
        </div>
      )}
      {editable && pic.status !== "loading" && (
        <>
          <input ref={input} id={inputId} type="file" accept="image/*" className="ui-visually-hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" className="ui-raised gl-picture__add" onClick={() => input.current?.click()}>
            {pic.status === "missing" ? "Add picture" : "Change"}
          </button>
          {pic.status === "ready" && (
            <button type="button" className="gl-picture__remove" onClick={() => removeGoalPicture(goalId)} aria-label={`Remove the picture of ${name}`}>
              <Icon name="close" size={12} />
            </button>
          )}
        </>
      )}
      {error && (
        <p className="gl-picture__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
