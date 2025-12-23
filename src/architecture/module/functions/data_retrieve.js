import quranClient from '../clients/quranClient'

export async function retrieveSurah(surahId, translation_id) {
    const surah = await quranClient?.verses?.findByChapter(surahId, {
        words: true,
        translations: [translation_id],
        wordFields: ['textUthmani', 'transliteration', 'translation'],
        per_page: 300,
        page: 1
    })
    const verses = surah?.map(data => {
    const translation = data?.translations?.map(translation => translation?.text)[0]
    const words = data?.words?.map(word => word?.textUthmani) 
    const word_audios = data?.words?.map(word => 'https://audio.qurancdn.com/'+word?.audioUrl)?.slice(0, -1)
    const word_translations = data?.words?.map(word => ({
        text: word?.textUthmani || '',
        transliteration: word?.transliteration?.text || '',
        translation: word?.translation?.text || '',
        audio: word?.audioUrl ? 'https://audio.qurancdn.com/' + word?.audioUrl : null,
        charType: word?.charTypeName || 'word'
    }))?.filter(w => w.charType === 'word') // Filter out non-word characters like end markers
    const verse = data?.words?.map(word => word?.textUthmani)?.join(' ')
    const key = data?.verseKey
    return (
        {
        verse,
        translation,
        words,
        word_audios,
        word_translations,
        key
        }
    )
})
    return verses
}

export async function retrieveTafseer(surahId, tafsirId) {
    const tafseer_data = await fetch(`https://api.quran.com/api/v4/tafsirs/${tafsirId}/by_chapter/${surahId}?per_page=300&page=1`)
    const tafseer = await tafseer_data.json()
    return tafseer;
}

export async function retrieveRecitation(chapterId, reciterId) {
    const recitation = await quranClient?.audio?.findVerseRecitationsByChapter(chapterId, reciterId, {
        per_page: 300,
        page: 1
    });
    const audioFiles = recitation?.audioFiles?.map(verse => {
        const verseKey = verse?.verseKey;
        const audioUrl = 'https://audio.qurancdn.com/' + verse?.url;
        return { verseKey, audioUrl };
    })
    return audioFiles;
}

