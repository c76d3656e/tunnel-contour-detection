from pathlib import Path
import laspy
import numpy as np

def read_las(path: str | Path) -> np.ndarray:
    las = laspy.read(path)
    return np.column_stack((np.asarray(las.x), np.asarray(las.y), np.asarray(las.z))).astype(float)

def metadata(path: str | Path) -> dict:
    las = laspy.read(path)
    xyz = np.column_stack((np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)))
    return {"point_count": int(len(xyz)), "min": xyz.min(0).tolist(), "max": xyz.max(0).tolist(), "dimensions": list(las.point_format.dimension_names)}
