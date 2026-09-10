import numpy as np
from .geometry import frame

def extract(points, center, axis, thickness):
    s = (points-center) @ axis
    u, w = frame(axis)
    lo, hi = s.min(), s.max(); result=[]
    for i, start in enumerate(np.arange(lo, hi, thickness)):
        mask=(s>=start)&(s<start+thickness); p=points[mask]
        if len(p):
            c=center+(start+thickness/2)*axis
            result.append((i,start,p,(p-c)@u,(p-c)@w))
    return result
