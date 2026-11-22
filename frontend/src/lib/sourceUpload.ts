import { api } from "./api";

const partSize = 3_500_000;

export async function uploadSource(
  file: File,
  notebook: string,
  signal?: AbortSignal,
) {
  const session = await api<{ id: string }>(
    `/notebooks/${notebook}/sources/upload-sessions`,
    {
      method: "POST",
      body: JSON.stringify({ name: file.name, size: file.size }),
      signal,
    },
    30_000,
  );
  try {
    const count = Math.ceil(file.size / partSize);
    for (let index = 0; index < count; index++) {
      const form = new FormData();
      form.append("file", file.slice(index * partSize, (index + 1) * partSize));
      await api(
        `/notebooks/${notebook}/sources/upload-sessions/${session.id}/parts/${index}`,
        { method: "PUT", body: form, signal },
        60_000,
      );
    }
    return await api(
      `/notebooks/${notebook}/sources/upload-sessions/${session.id}/complete`,
      { method: "POST", signal },
      60_000,
    );
  } catch (error) {
    await api(`/notebooks/${notebook}/sources/upload-sessions/${session.id}`, {
      method: "DELETE",
    }).catch(() => {});
    throw error;
  }
}
