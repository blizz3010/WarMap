export const PRIMARY_THEATERS = [
  { id: "iran", label: "Iran" },
  { id: "israel-palestine", label: "Israel-Palestine" },
  { id: "yemen", label: "Yemen" },
  { id: "ukraine", label: "Ukraine" }
];

export function newsTheaterForRegion(regionId) {
  const id = String(regionId || "ukraine");
  if (id === "israel-palestine" || id === "yemen" || id === "iran" || id === "gulf" || id === "middle-east") {
    return id;
  }
  if (id.startsWith("ukraine") || id === "black-sea") {
    return "ukraine";
  }
  return "iran";
}

export function primaryTheaterIsActive(theaterId, regionId) {
  if (theaterId === "ukraine") {
    return String(regionId).startsWith("ukraine") || regionId === "black-sea";
  }
  return theaterId === regionId;
}
