import mitt from "mitt";

type Events = {
  "error:anon-limit": void;
  "error:network": void;
};

const emitter = mitt<Events>();

export const apiEvents = {
  emit: emitter.emit.bind(emitter),
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    emitter.on(event, handler);
    return () => emitter.off(event, handler);
  },
};
