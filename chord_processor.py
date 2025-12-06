import music21
import re

def process_chord_progression(chord_text, output_path):
    print(f"Processing: {chord_text}")
    
    # Replace newlines with spaces and split
    raw_chords = chord_text.replace('\n', ' ').split()
    
    s = music21.stream.Score()
    p = music21.stream.Part()
    p.append(music21.meter.TimeSignature('4/4'))
    
    # Constraints for readable staff pitch
    TARGET_ROOT_MIN = 60 # C4
    TARGET_ROOT_MAX = 71 # B4

    for token in raw_chords:
        try:
            if not token: continue
            
            # --- Robust Parsing with Greedy Regex ---
            match = re.match(r'^([A-Ga-g])([b#\-]?)(.*)$', token)
            
            if not match:
                print(f"[Py] Warning: Regex failed for '{token}'. Skipping.")
                continue

            root_str = match.group(1).upper()
            accidental_str = match.group(2) # '' or 'b' or '#' or '-'
            suffix_str = match.group(3)
            
            # --- Normalization ---
            # 1. Normalize Root Accidental for Pitch Construction
            if accidental_str == 'b':
                pitch_acc = '-'
            elif accidental_str == '#':
                pitch_acc = '#'
            elif accidental_str == '-':
                pitch_acc = '-'
            else:
                pitch_acc = ''
                
            pitch_root_str = root_str + pitch_acc
            
            # 2. Normalize Suffix for Template Construction
            m21_suffix = suffix_str
            m21_suffix = m21_suffix.replace('M7', 'maj7')
            m21_suffix = m21_suffix.replace('△', 'maj7')
            
            # Handle lone 'M' contextually
            if 'M' in m21_suffix and 'maj' not in m21_suffix:
                m21_suffix = m21_suffix.replace('M', 'maj')
                
            # --- Transposition Strategy ---
            template_str = 'C' + m21_suffix
            
            print(f"[Py] Debug: Token='{token}' -> R='{root_str}' A='{accidental_str}' S='{suffix_str}'")
            print(f"      -> Template='{template_str}' TargetRoot='{pitch_root_str}'")
            
            try:
                template_chord = music21.harmony.ChordSymbol(template_str)
            except Exception as e_tmpl:
                print(f"[Py] Warning: Template '{template_str}' invalid: {e_tmpl}. Falling back.")
                template_chord = music21.harmony.ChordSymbol('C')
                template_chord.figure = token

            # 2. Transpose Template to Target Root
            c_pitch = music21.pitch.Pitch('C4')
            target_pitch = music21.pitch.Pitch(pitch_root_str + '4')
            
            interval = music21.interval.Interval(c_pitch, target_pitch)
            
            print(f"      -> Interval: {interval.name} ({interval.semitones} semitones)")
            
            # Transpose
            final_chord = template_chord.transpose(interval)
            
            # --- Note Generation ---
            # We must preserve the spelling (Ab vs G#) from the transposed chord `final_chord`.
            original_pitches = list(final_chord.pitches)
            if not original_pitches: raise ValueError("No notes generated")
            
            # Use dictionary to map PC -> Pitch Object with correct spelling
            pc_to_pitch = {}
            for p_obj in original_pitches:
                if p_obj.pitchClass not in pc_to_pitch:
                    pc_to_pitch[p_obj.pitchClass] = p_obj
                    
            root_pc = final_chord.root().pitchClass
            unique_pcs = list(pc_to_pitch.keys())
            
            # Sort/Rotate PCs to start with Root
            if root_pc in unique_pcs:
                unique_pcs.sort()
                try:
                     root_idx = unique_pcs.index(root_pc)
                except ValueError: 
                     root_idx = 0
                sorted_pcs = unique_pcs[root_idx:] + unique_pcs[:root_idx]
            else:
                sorted_pcs = unique_pcs

            # Construct new display pitches preserving spelling
            new_pitches = []
            
            # Base Note (Root)
            # Use strict spelling from transposed chord
            base_spelling_pitch = pc_to_pitch[sorted_pcs[0]]
            base_p = music21.pitch.Pitch(base_spelling_pitch.name)
            base_p.octave = 4 
            
            # Adjust range
            while base_p.ps < TARGET_ROOT_MIN:
                base_p.octave += 1
            while base_p.ps > TARGET_ROOT_MAX:
                base_p.octave -= 1
                
            new_pitches.append(base_p)
            last_ps = base_p.ps
            
            for pc in sorted_pcs[1:]:
                spelling_p = pc_to_pitch[pc]
                pitch_obj = music21.pitch.Pitch(spelling_p.name)
                pitch_obj.octave = base_p.octave 
                 
                while pitch_obj.ps <= last_ps:
                    pitch_obj.octave += 1
                new_pitches.append(pitch_obj)
                last_ps = pitch_obj.ps
            
            c = music21.chord.Chord(new_pitches)
            c.duration.type = 'whole'
            
            m = music21.stream.Measure()
            m.append(final_chord) # Symbol
            m.append(c) # Notes
            p.append(m)
            
        except Exception as e:
            print(f"[Py] Error processing '{token}': {e}")
            m = music21.stream.Measure()
            m.append(music21.note.Rest(type='whole'))
            p.append(m)

    s.append(p)
    s.write('musicxml', fp=output_path)
    print(f"Wrote to {output_path}")
