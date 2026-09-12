import { useEffect, useRef, useState } from "react";

type CreatorAvatarCreator = {
  display_name: string;
  profile_image_url: string | null;
};

export function CreatorAvatar({
  creator,
  sizeClass,
  fallbackTextClass,
}: {
  creator: CreatorAvatarCreator;
  sizeClass: string;
  fallbackTextClass: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageUrl = creator.profile_image_url?.trim();

  // The server renders the <img> before React hydrates, so an image that fails
  // during that window never fires onError. Re-check the decoded state on mount.
  useEffect(() => {
    const node = imageRef.current;
    if (node && node.complete && node.naturalWidth === 0) setImageFailed(true);
  }, [imageUrl]);

  if (imageUrl && !imageFailed) {
    return (
      <img
        ref={imageRef}
        src={imageUrl}
        alt=""
        className={`${sizeClass} shrink-0 border-2 border-border object-cover`}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} ${fallbackTextClass} flex shrink-0 items-center justify-center border-2 border-border bg-accent font-extrabold`}
    >
      {creator.display_name.slice(0, 1)}
    </div>
  );
}
