const API_URL = import.meta.env.VITE_API_URL;

export async function getUsers() {
    const response = await fetch(
        `${API_URL}/api/users`
    );

    if (!response.ok) {
        throw new Error("Failed to fetch users");
    }

    return response.json();
}
