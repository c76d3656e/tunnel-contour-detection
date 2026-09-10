import numpy as np
from scipy.optimize import least_squares


def fit_circle(x: np.ndarray, y: np.ndarray):
    if len(x) < 3:
        raise ValueError("at least 3 contour points are required")

    def residual(q):
        return np.hypot(x - q[0], y - q[1]) - q[2]

    origin = np.array([np.median(x), np.median(y)])
    q0 = [origin[0], origin[1], np.median(np.hypot(x - origin[0], y - origin[1]))]
    scale = max(0.02, float(np.median(np.abs(residual(q0))) * 2.5))
    result = least_squares(residual, q0, loss="soft_l1", f_scale=scale, max_nfev=500)
    fitted = result.x
    errors = residual(fitted)
    return {
        "center_x": float(fitted[0]),
        "center_y": float(fitted[1]),
        "radius": float(abs(fitted[2])),
        "rmse": float(np.sqrt(np.mean(errors ** 2))),
        "max_error": float(np.max(np.abs(errors))),
    }
