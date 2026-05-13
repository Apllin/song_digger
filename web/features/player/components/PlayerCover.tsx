import { useEffect, useState } from "react";

interface PlayerCoverProps {
  coverUrl: string | null;
}

export function PlayerCover({ coverUrl }: PlayerCoverProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [coverUrl]);

  if (coverUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={coverUrl}
        alt=""
        className="w-9 h-9 rounded-lg object-cover shrink-0"
        style={{ border: "1px solid var(--td-hair)" }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className="w-9 h-9 rounded-lg shrink-0 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(185,163,232,0.35), rgba(58,36,64,0.6))",
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle at 70% 30%, var(--td-accent-soft), transparent 50%)",
        }}
      />
    </div>
  );
}
