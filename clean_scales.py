import json

with open('federation_scales.json', 'r') as f:
    data = json.load(f)

for title, title_data in data.items():
    # Determine the rank system for this title
    uses_grades = "Administrator" in title or "Coordinator" in title
    uses_levels = "Educator" in title
    
    for variant in title_data['variants']:
        scales = variant.get('scales', {})
        cleaned_scales = {}
        for rank, steps in scales.items():
            if uses_grades:
                if "Grade" in rank:
                    cleaned_scales[rank] = steps
            elif uses_levels:
                if "Level" in rank:
                    cleaned_scales[rank] = steps
            else:
                if rank in ["Assistant", "Associate", "Full"]:
                    cleaned_scales[rank] = steps
                elif rank == "None":
                    # Some don't have ranks, just steps
                    cleaned_scales[rank] = steps
                
        variant['scales'] = cleaned_scales

with open('federation_scales_clean.json', 'w') as f:
    json.dump(data, f, indent=4)
print("Cleaned!")
