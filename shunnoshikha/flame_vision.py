#!/usr/bin/env python3
"""
ShunnoShikha AI - Module 4: Computer Vision Flame & Tomography Analyzer
Tracks microgravity spherical/oval flame geometry frame-by-frame:
- Flame Area (Af in mm² and pixels)
- Flame Spread Rate (Vf in mm/s)
- Aspect Ratio (Major Axis / Minor Axis)
- Standoff Distance (from fuel leading edge)
- Pseudo-Color Thermal Tomography Zones (Inferno/Jet colormap)
- Base64 image export for real-time web mission-control visualization
"""

import os
import base64
import numpy as np
import cv2
from typing import Dict, Any, Optional

SAMPLE_FLAME_DIR = "data/flame_frames"
os.makedirs(SAMPLE_FLAME_DIR, exist_ok=True)

class FlameVisionAnalyzer:
    """Computer Vision processing engine for microgravity flame imagery and kinematics."""
    
    def __init__(self, pixel_to_mm_ratio: float = 0.12):
        self.pixel_to_mm = pixel_to_mm_ratio # Scale factor: 0.12 mm per pixel
        self._ensure_sample_flame_frames()

    def _ensure_sample_flame_frames(self):
        """Generates synthetic NASA BASS-II flame frame sequence for test and demo."""
        for frame_idx in range(5):
            fname = os.path.join(SAMPLE_FLAME_DIR, f"bass2_flame_f{frame_idx+1}.png")
            if not os.path.exists(fname):
                img = self.generate_synthetic_microg_flame(
                    flow_cms=7.5,
                    o2_pct=21.0,
                    frame_num=frame_idx + 1
                )
                cv2.imwrite(fname, img)

    def generate_synthetic_microg_flame(
        self,
        flow_cms: float = 7.5,
        o2_pct: float = 21.0,
        frame_num: int = 1,
        width: int = 400,
        height: int = 240
    ) -> np.ndarray:
        """
        Synthesizes a physically-realistic microgravity oval diffusion flame:
        - Dim blue chemiluminescent core
        - Yellow/orange radiant soot envelope
        - Cast fuel rod surface in MSG glovebox view
        """
        img = np.zeros((height, width, 3), dtype=np.uint8)
        
        # 1. Dark ISS Microgravity Science Glovebox (MSG) background with grid lines
        for y in range(0, height, 40):
            cv2.line(img, (0, y), (width, y), (18, 22, 28), 1)
        for x in range(0, width, 40):
            cv2.line(img, (x, 0), (x, height), (18, 22, 28), 1)
            
        # 2. Solid Fuel Sample Rod (PMMA cylinder mounted horizontally)
        rod_y = height // 2
        rod_thickness = 24
        cv2.rectangle(img, (0, rod_y - rod_thickness // 2), (width, rod_y + rod_thickness // 2), (60, 65, 75), -1)
        cv2.line(img, (0, rod_y - rod_thickness // 2), (width, rod_y - rod_thickness // 2), (100, 110, 125), 1)
        cv2.line(img, (0, rod_y + rod_thickness // 2), (width, rod_y + rod_thickness // 2), (40, 45, 50), 1)
        
        # 3. Microgravity Flame Geometry
        # Spreads forward from left to right as frame_num advances
        center_x = 120 + (frame_num - 1) * 22
        center_y = rod_y
        
        # Flame size scales with O2 and flow velocity
        major_axis = int(35 + (o2_pct / 21.0) * 25 + (flow_cms * 1.2))
        minor_axis = int(22 + (o2_pct / 21.0) * 16)
        
        # Outer radiant soot halo (diffuse orange/yellow)
        cv2.ellipse(img, (center_x, center_y), (major_axis + 10, minor_axis + 8), 0, 0, 360, (0, 80, 210), -1)
        # Main reaction zone (bright yellow/white)
        cv2.ellipse(img, (center_x - 4, center_y), (major_axis, minor_axis), 0, 0, 360, (20, 190, 255), -1)
        # Inner blue chemiluminescent core (CH* / C2 emission)
        cv2.ellipse(img, (center_x - 12, center_y), (major_axis // 2, minor_axis // 2), 0, 0, 360, (230, 140, 20), -1)
        
        # Apply Gaussian blur to simulate luminous optical glow
        img = cv2.GaussianBlur(img, (15, 15), 5)
        
        # Add frame timestamp overlay
        cv2.putText(img, f"NASA BASS-II | ISS MSG | Frame #{frame_num}", (12, 25), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 215, 230), 1, cv2.LINE_AA)
        cv2.putText(img, f"O2: {o2_pct:.1f}% | Flow: {flow_cms:.1f} cm/s", (12, 45), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (140, 160, 180), 1, cv2.LINE_AA)
        
        return img

    def analyze_frame(
        self,
        image_input: Any, # Can be numpy array, file path, or bytes
        previous_centroid_x: Optional[float] = None,
        dt_seconds: float = 1.0 / 30.0 # Standard 30 FPS camera
    ) -> Dict[str, Any]:
        """
        Performs full computer vision flame segmentation and kinematics extraction:
        - Contour identification
        - Area and aspect ratio
        - Spread rate
        - Pseudo-color thermal tomography map
        """
        # Load image into numpy array
        if isinstance(image_input, str):
            if os.path.exists(image_input):
                img_bgr = cv2.imread(image_input)
            else: # Base64 string
                img_bytes = base64.b64decode(image_input.split(",")[-1])
                img_arr = np.frombuffer(img_bytes, dtype=np.uint8)
                img_bgr = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
        elif isinstance(image_input, bytes):
            img_arr = np.frombuffer(image_input, dtype=np.uint8)
            img_bgr = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
        else:
            img_bgr = image_input.copy()

        if img_bgr is None:
            raise ValueError("The uploaded image could not be decoded.")

        h, w, _ = img_bgr.shape
        original_img = img_bgr.copy()
        
        # 1. Use warm, saturated pixels for flame segmentation. A brightness-only
        # threshold incorrectly labels white cabin surfaces and text as fire.
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
        hue, saturation, value = cv2.split(hsv)
        warm_mask = (
            (((hue <= 35) | (hue >= 170)) & (saturation >= 80) & (value >= 100))
            | ((hue >= 15) & (hue <= 45) & (saturation >= 45) & (value >= 150))
        ).astype(np.uint8) * 255
        thresh = cv2.morphologyEx(
            warm_mask,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
        )
        
        # Morphological opening to remove optical sensor noise
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
        
        # 2. Extract flame contours
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        annotated_img = img_bgr.copy()
        thermal_map = cv2.applyColorMap(gray, cv2.COLORMAP_INFERNO)
        
        flame_found = False
        area_px = 0.0
        area_mm2 = 0.0
        centroid = (w // 2, h // 2)
        aspect_ratio = 1.0
        major_axis_mm = 0.0
        minor_axis_mm = 0.0
        standoff_distance_mm = 0.0
        spread_rate_mms = 0.0
        fire_pixel_ratio = float(np.count_nonzero(thresh)) / float(max(1, w * h))
        detected_regions = []
        
        if contours:
            valid_contours = [c for c in contours if cv2.contourArea(c) > 80.0]
            if valid_contours:
                # The largest warm, saturated contour is the likely flame envelope.
                c = max(valid_contours, key=cv2.contourArea)
                area_px = float(cv2.contourArea(c))
                flame_found = True
                area_mm2 = round(area_px * (self.pixel_to_mm ** 2), 2)
                for region in valid_contours:
                    x, y, region_w, region_h = cv2.boundingRect(region)
                    cv2.rectangle(annotated_img, (x, y), (x + region_w, y + region_h), (0, 255, 0), 2)
                    detected_regions.append({
                        "x": int(x), "y": int(y),
                        "width": int(region_w), "height": int(region_h),
                        "area_px": round(float(cv2.contourArea(region)), 1),
                    })
                
                # Centroid via moments
                M = cv2.moments(c)
                if M["m00"] != 0:
                    cx = int(M["m10"] / M["m00"])
                    cy = int(M["m01"] / M["m00"])
                    centroid = (cx, cy)
                else:
                    cx, cy = centroid

                # Fit minimum enclosing ellipse if enough points
                if len(c) >= 5:
                    ellipse = cv2.fitEllipse(c)
                    cv2.ellipse(annotated_img, ellipse, (0, 255, 0), 2)
                    (ecx, ecy), (d1, d2), angle = ellipse
                    major_axis = max(d1, d2)
                    minor_axis = min(d1, d2)
                    aspect_ratio = round(float(major_axis / max(1.0, minor_axis)), 2)
                    major_axis_mm = round(float(major_axis * self.pixel_to_mm), 2)
                    minor_axis_mm = round(float(minor_axis * self.pixel_to_mm), 2)
                else:
                    x_b, y_b, w_b, h_b = cv2.boundingRect(c)
                    cv2.rectangle(annotated_img, (x_b, y_b), (x_b + w_b, y_b + h_b), (0, 255, 0), 2)
                    major_axis_mm = round(float(w_b * self.pixel_to_mm), 2)
                    minor_axis_mm = round(float(h_b * self.pixel_to_mm), 2)

                # Draw centroid crosshair
                cv2.drawMarker(annotated_img, (cx, cy), (0, 0, 255), cv2.MARKER_CROSS, 16, 2)
                
                # Leading flame standoff distance (distance from left image boundary or fuel mount)
                x_min = int(np.min(c[:, 0, 0]))
                standoff_px = cx - x_min
                standoff_distance_mm = round(float(standoff_px * self.pixel_to_mm), 2)
                cv2.line(annotated_img, (x_min, cy), (cx, cy), (255, 255, 0), 2)

                # Spread Rate calculation: displacement of flame front over time
                if previous_centroid_x is not None:
                    dx_px = cx - previous_centroid_x
                    spread_rate_mms = round(float((dx_px * self.pixel_to_mm) / dt_seconds), 3)
                else:
                    spread_rate_mms = 0.35 # Nominal microgravity baseline for PMMA

                # Annotations text
                cv2.putText(annotated_img, f"Flame Area: {area_mm2:.1f} mm2 | Aspect: {aspect_ratio}", 
                            (12, h - 35), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 255, 0), 1, cv2.LINE_AA)
                cv2.putText(annotated_img, f"Spread Rate Vf: {spread_rate_mms:.2f} mm/s | Standoff: {standoff_distance_mm:.1f} mm", 
                            (12, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 255, 255), 1, cv2.LINE_AA)

        if flame_found:
            finding_summary = (
                f"Visible flame-like heat signature detected in {len(detected_regions)} region"
                f"{'' if len(detected_regions) == 1 else 's'}. "
                "The green outlines and crosshair mark the areas selected for review."
            )
            finding_status = "FIRE_SIGNATURE_DETECTED"
            confidence = round(min(0.99, 0.55 + fire_pixel_ratio * 8), 2)
        else:
            finding_summary = (
                "No visible flame, fire glow, smoke-like plume, or other clear fire signature "
                "was detected. The image may still require human review if it is dark, blurred, "
                "obstructed, or captured outside the calibrated camera range."
            )
            finding_status = "NO_FIRE_SIGNATURE_DETECTED"
            confidence = round(max(0.5, 0.95 - fire_pixel_ratio * 3), 2)

        # 3. Base64 encoding for API & Web delivery
        _, buf_original = cv2.imencode(".png", original_img)
        b64_original = "data:image/png;base64," + base64.b64encode(buf_original).decode("utf-8")
        _, buf_ann = cv2.imencode(".png", annotated_img)
        b64_annotated = "data:image/png;base64," + base64.b64encode(buf_ann).decode("utf-8")
        
        _, buf_therm = cv2.imencode(".png", thermal_map)
        b64_thermal = "data:image/png;base64," + base64.b64encode(buf_therm).decode("utf-8")

        return {
            "flame_detected": flame_found,
            "flame_area_mm2": area_mm2,
            "flame_area_px": area_px,
            "aspect_ratio": aspect_ratio,
            "major_axis_mm": major_axis_mm,
            "minor_axis_mm": minor_axis_mm,
            "centroid": {"x": centroid[0], "y": centroid[1]},
            "standoff_distance_mm": standoff_distance_mm,
            "flame_spread_rate_mms": spread_rate_mms,
            "finding_status": finding_status,
            "finding_summary": finding_summary,
            "detection_confidence": confidence,
            "fire_pixel_ratio": round(fire_pixel_ratio, 4),
            "detected_regions": detected_regions,
            "original_image_b64": b64_original,
            "annotated_image_b64": b64_annotated,
            "comparison_image_b64": b64_annotated,
            "thermal_tomography_b64": b64_thermal
        }
